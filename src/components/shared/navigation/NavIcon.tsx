import { NavItemId } from "@/constants/navigation";
import BoxIcon from "../icons/BoxIcon";
import CashIcon from "../icons/CashIcon";
import HistoryIcon from "../icons/HistoryIcon";
import ClientsIcon from "../icons/ClientsIcon";
import MoreIcon from "../icons/MoreIcon";
import OrdersIcon from "../icons/OrdersIcon";
import PaymentsIcon from "../icons/PaymentsIcon";
import PriceIcon from "../icons/PriceIcon";
import ProductionIcon from "../icons/ProductionIcon";
import UsersIcon from "../icons/UsersIcon";

interface NavIconProps {
  id: NavItemId;
  className?: string;
}

const icons: Record<NavItemId, typeof OrdersIcon> = {
  orders: OrdersIcon,
  clients: ClientsIcon,
  production: ProductionIcon,
  boxes: BoxIcon,
  payments: PaymentsIcon,
  cash: CashIcon,
  audit: HistoryIcon,
  prices: PriceIcon,
  users: UsersIcon,
  more: MoreIcon,
};

/** Значок розділу меню за його кодом. Значки не передаємо з сервера як компоненти, лише код. */
export default function NavIcon({ id, className }: NavIconProps) {
  const Icon = icons[id];
  return <Icon className={className} />;
}
