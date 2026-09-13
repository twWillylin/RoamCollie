# RoamCollie 資料庫與後端規劃

狀態：設計草案；尚未建立資料庫、執行 migration 或修改前端資料來源。
SQL 位於 `database/schema.sql`，預計搭配 PostgreSQL 16 以上。

## 系統分工

瀏覽器 React + Tailwind → HTTPS JSON API（Node.js + TypeScript）→ PostgreSQL。

建議同一個 repository 保留前端、增加後端服務；部署時可由 Docker Compose 管理 API 與 PostgreSQL。正式環境的反向代理提供網頁並將 `/api` 導向後端，可用相同網域減少跨來源設定。PostgreSQL 僅開放給後端所在的私有網路，帳密只放在後端環境變數，不可使用 VITE_ 變數提供給前端。開發階段由 Vite proxy 轉送 `/api`。

後端负责登入身分、行程權限、分帳計算、資料驗證、交易與資料讀寫；前端可預覽計算結果，但以後端儲存結果為準。可選 Fastify 或 Express；此階段不必引入微服務、Redis 或訊息佇列。

## 六張表

| 表 | 用途 | 重要欄位 |
| --- | --- | --- |
| users | 登入身分 | id、auth_subject、display_name |
| trips | 行程 | owner_user_id、name、destination、start_date、days、currency_code |
| trip_members | 行程內的旅伴 | trip_id、user_id（可空）、display_name、role、left_at |
| expenses | 誰先付了哪一筆 | trip_id、payer_member_id、created_by_user_id、amount_cents、split_mode、expense_date |
| expense_shares | 每筆支出的實際分攤 | expense_id、member_id、amount_cents |
| settlements | 實際還款紀錄 | from_member_id、to_member_id、amount_cents、status、confirmed_at |

關係：users 1:N trips（建立者）；users 1:N trip_members；trips 1:N trip_members / expenses / settlements；expenses 1:N expense_shares；trip_members 1:N expense_shares。

旅伴與登入帳號分開：可先新增尚未註冊的旅伴，日後再綁定帳號。同一帳號在同一行程只能加入一次。姓名只供顯示，所有關聯使用 UUID；兩人同名也不會混帳。訪客無法自行透過 API 操作，必須由已登入且有權限的旅伴代登記。帳號綁定需經授權流程，不能只依同名自動認領。

`auth_subject` 預留給登入服務的穩定身分識別碼（多提供者時包含提供者命名空間）；尚未選定登入方式，因此此版不規劃自管密碼、session、邀請 token 的資料表。這些需在實作登入時補齊。

## 金額與分帳

第一版統一 TWD，整數分：100.50 元存為 10050。不使用浮點數或 PostgreSQL money。單筆最高一億元，符合目前前端上限。PostgreSQL bigint / SUM(bigint) 常經 driver 回傳字串，API 建議明訂金額欄位為十進位整數字串；前端轉 Number 前檢查安全整數範圍，總計亦同。

平均分帳和指定分帳都儲存最終的 expense_shares。不要每次依「目前旅伴數」重算歷史帳，新增或離開旅伴不應改變舊帳。

例如 100 元三人均分：3334、3333、3333 分；餘分按 trip_members.sort_order、id 排序分配並儲存。指定分帳可以只有部分旅伴參與，也允許選定旅伴分到零元。

必要規則：

1. 每筆有效支出至少一筆 share，且所有 share 合計等於 amount_cents。
2. 付款人、分攤者、轉帳雙方均屬於同一行程；SQL 使用複合外鍵強制保證。
3. 新增支出不能指定已離開的旅伴；既有帳目保留其參與資訊。離開後仍可清償舊債。
4. 日期使用 date，稽核時間使用 timestamptz；訂房預付款可早於旅行開始日，不限制支出日必須在旅程期間。

跨列合計不能用一般 CHECK 約束保證。此 SQL 草案只涵蓋單列限制與外鍵；後端必須在同一 transaction 內驗證並寫入 expense + shares。若未來允許其他程式直接寫資料，需再增加 deferred constraint trigger 等資料庫層驗證，不能宣稱此草案已保證分攤總額。

## 建議結算與實際還款

建議轉帳是計算結果，不需要另外存表。每人餘額：

應收餘額 = 先付支出 − 分攤支出 + 已確認付出的還款 − 已確認收到的還款。

正數代表應收，負數代表應付。只計算未刪除支出、status = confirmed 的還款。所有人的餘額合計應為零。範例：A 先付 100 元、A/B 各分 50 元，B 還 A 50 元並確認後，兩人的餘額都變成零。

settlements 記錄線下實際付款，不會真的扣款。初步流程：付款人登記 pending → 收款人確認 confirmed；訪客由行程管理者代為確認。voided 表示紀錄作廢並停止計入餘額，已確認紀錄須由收款人或管理者作廢，保留確認欄位。一般成員只能取消自己尚未確認的紀錄。確認身分由登入 session 取得，不接受用戶端任意指定 confirmed_by_user_id。

第一期可先做行程、支出和建議結算，實際還款紀錄作為下一步；資料表先預留。

## 權限與一致性

- 建立行程：同一 transaction 新增 trips 與建立者的 admin 旅伴資料。
- 只有該行程的有效、已綁定登入帳號成員可以讀取；管理者可管理旅伴和行程。
- 成員可替旅伴登記付款，但 created_by_user_id 必須記錄真正操作者；一般成員只能修改自己登記的支出，管理者可修改全行程支出。
- trips.owner_user_id 是行程擁有者的權威來源；API 必須維持其為有效 admin，不允許移除或降級，除非在同一交易內完成擁有權移轉。
- 所有會改變行程成員、帳目或還款的 API，先在 transaction 內鎖定 trips 該列（SELECT ... FOR UPDATE），再檢查權限與寫入。第一版以行程為單位序列化寫入，避免成員退出、重複確認、結算與支出修改的競態。
- 修改支出傳入預期 version；不符回傳 409，成功後 version + 1 並更新 updated_at。SQL 的 updated_at default 只負責建立，更新值由 API 維護。
- 支出與 shares 一起寫入或回滾；刪除支出以 deleted_at 軟刪除。旅伴以 left_at 保留歷史；行程以 archived_at 封存，第一版不硬刪除。
- UUID 由用戶端或 API 產生；手機重送建立請求時沿用同一 ID。相同 ID / 相同內容回傳既有結果，不同內容回傳 409，需在 API 實作比較，避免重複記帳。
- 一般 API 資料庫角色只允許必要 DML，不使用 superuser。此草案沒有 RLS，資料隔離依 API 權限檢查；未來若開放直連資料 API，必須補 RLS。

## API 草案

| 方法 / 路徑 | 功能 |
| --- | --- |
| GET /api/trips | 我的行程 |
| POST /api/trips | 建立行程與旅伴 |
| GET /api/trips/:tripId | 行程與旅伴資訊 |
| PATCH /api/trips/:tripId | 更新行程或封存 |
| POST /api/trips/:tripId/members | 加入旅伴 |
| PATCH /api/trips/:tripId/members/:memberId | 修改旅伴、標記離開 |
| GET /api/trips/:tripId/expenses | 分頁、搜尋與分類 |
| POST /api/trips/:tripId/expenses | 新增支出與分攤 |
| PATCH /api/trips/:tripId/expenses/:expenseId | 修改支出與分攤，檢查 version |
| DELETE /api/trips/:tripId/expenses/:expenseId | 軟刪除，檢查 version |
| GET /api/trips/:tripId/balances | 總支出、每人餘額、建議轉帳 |
| POST /api/trips/:tripId/settlements | 登記實際还款 |
| PATCH /api/trips/:tripId/settlements/:settlementId | 確認或作廢還款 |

登入、登出、邀請、訪客綁定的 API 在選定登入模式後補充。後續若要同一行程同時使用 JPY/TWD 等多幣別，需新增原幣金額、幣別、匯率及換算基準金額，不能只解除 currency_code 的 CHECK 就視為支援換匯。

## 實作時的驗證項目

SQL 尚未在 PostgreSQL 執行。正式 migration 前應測試：建表、跨行程外鍵拒絕、分攤不合回滾、100 分三人分攤、同名旅伴、同時編輯回傳 409、重複 POST 不重複入帳、未授權讀寫遭拒、刪除支出與確認/作廢還款後餘額正確。

## 參考

- PostgreSQL constraints：https://www.postgresql.org/docs/18/ddl-constraints.html
- PostgreSQL numeric types：https://www.postgresql.org/docs/16/datatype-numeric.html
