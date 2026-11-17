import { requirePageUser } from "@/server/page-access";

/** Захист екрана «ТТН на день»: власник, менеджер і старший локації; інші переходять на свою сторінку. */
export default async function ShipmentsLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser("shipments");
  return children;
}
