import TabLinks from "../shared/tabs/TabLinks";

/** Вкладки «Фінрезультату»: підсумки й витрати місяця та сировина CO2. */
export default function FinanceTabs({ active }: { active: "month" | "co2" }) {
  return (
    <TabLinks
      label="Розділ фінрезультату"
      activeId={active}
      items={[
        { id: "co2", label: "Сировина CO2", href: "/finance" },
        { id: "month", label: "Місяць", href: "/finance/month" },
      ]}
    />
  );
}
