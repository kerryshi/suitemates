# Financial: Kerry

Branch: `fin/nessie` · commit prefix `[financial]` · only edit `personas/financial/`
Done when: a fake purchase posted to Nessie gets a roast within 10 seconds.

Already working (keyless): `MOCK=1 npm run chat -- financial` then type `recent purchases`

- [x] `get_recent_purchases` over mock/nessie-purchases.json
- [x] `weekly_money` trigger: `npm run trigger -- financial weekly_money`
- [ ] Nessie key (nessieisreal.com, GitHub sign-in) → `NESSIE_API_KEY`, create a customer + account → `NESSIE_ACCOUNT_ID`
- [ ] Verify `nessie.ts` against the real API (`MOCK=0`), post one test purchase
- [ ] Turn on `watch()` (sketch in watch.ts): new purchase → roast within 10 s (WATCH_MS=10000)
- [ ] Tools: `can_i_afford`, savings goal progress, plan cost (mock/students.json has `costEstimate`)
- [ ] Receipt photo review (inbound images already reach the LLM)
- [ ] Voice in `prompt.md`: casual, funny mentor. Roast the purchase, never the person. No investment advice.
- [ ] Financial avatar
