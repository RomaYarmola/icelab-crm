import TabLinks from "../shared/tabs/TabLinks";

/** Вкладки «Фінрезультату»: звіт, внесення сум за місяць і сировина CO2. */
export default function FinanceTabs({ active }: { active: "report" | "month" | "co2" }) {
  return (
    <TabLinks
      label="Розділ фінрезультату"
      activeId={active}
      items={[
        { id: "report", label: "Звіт", href: "/finance/report" },
        { id: "month", label: "Місяць", href: "/finance/month" },
        { id: "co2", label: "Сировина CO2", href: "/finance" },
      ]}
    />
  );
}
