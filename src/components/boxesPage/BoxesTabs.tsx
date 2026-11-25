import TabLinks from "../shared/tabs/TabLinks";

export type BoxesTabId = "registry" | "debts" | "stock" | "returns";

interface BoxesTabsProps {
  active: BoxesTabId;
  /** Реєстр бачать лише власник і старший локації. */
  showRegistry: boolean;
  /** Виробництво боргів і складу не бачить (D113): у нього сканер і «Чекають на пошті». */
  production?: boolean;
}

/** Вкладки розділу «Бокси». Кожна має свою адресу. */
export default function BoxesTabs({ active, showRegistry, production = false }: BoxesTabsProps) {
  const returns = { id: "returns", label: "На пошті", href: "/boxes/returns" };
  const items = production
    ? [{ id: "scan", label: "Сканер", href: "/scan" }, returns]
    : [
        ...(showRegistry ? [{ id: "registry", label: "Реєстр", href: "/boxes" }] : []),
        { id: "debts", label: "Борги", href: "/boxes/debts" },
        { id: "stock", label: "Склад", href: "/boxes/stock" },
        returns,
      ];
  return <TabLinks label="Розділи боксів" activeId={active} items={items} />;
}
