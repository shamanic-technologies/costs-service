import { eq } from "drizzle-orm";
import { db } from "./index.js";
import { orgPriceLists } from "./schema.js";
import { fetchOrgsCreatedFrom } from "../lib/client-service.js";
import { decidePriceList } from "../lib/org-price-list.js";
import { STANDARD_PRICE_LIST_FROM, type PriceListName } from "../lib/price-lists.js";

/**
 * The price list `orgId` pays, decided once and persisted (an org's creation instant never moves).
 * First ask for an org = one client-service read; every later one = one primary-key lookup.
 * client-service failing = `ClientServiceError` thrown (no price guessed).
 */
export async function priceListOfOrg(orgId: string): Promise<PriceListName> {
  const [known] = await db.select({ priceList: orgPriceLists.priceList }).from(orgPriceLists).where(eq(orgPriceLists.orgId, orgId)).limit(1);
  if (known) return known.priceList as PriceListName;
  const createdFromCutoff = await fetchOrgsCreatedFrom(STANDARD_PRICE_LIST_FROM);
  const createdAt = createdFromCutoff.get(orgId);
  const priceList = decidePriceList(createdAt);
  await db.insert(orgPriceLists).values({ orgId, priceList, orgCreatedAt: createdAt ?? null }).onConflictDoNothing();
  return priceList;
}
