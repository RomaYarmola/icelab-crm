import Link from "next/link";
import { NavItem as NavItemData } from "@/constants/navigation";
import { barItemClassName, popupItemClassName, sideItemClassName } from "./navItemStyles";
import NavIcon from "./NavIcon";

interface NavItemProps {
  item: NavItemData;
  isActive: boolean;
  /**
   * `bar`: нижня панель телефона, `popup`: список у попапі (розмір як у нижній панелі),
   * `side`: бічна панель комп'ютера.
   */
  variant: "bar" | "popup" | "side";
  /**
   * Якщо передано (лише для нижньої панелі), пункт стає кнопкою, що відкриває попап, а не
   * посиланням. Так працює «Ще».
   */
  onClick?: () => void;
  /** Попап пункта зараз відкритий (для екранних читалок). */
  isExpanded?: boolean;
  /**
   * Лише для нижньої панелі: чи малювати власну смужку активного пункту. Панель вимикає її, коли
   * замість неї працює плаваюча смужка, що плавно їде між пунктами (`useNavIndicator`).
   */
  showIndicator?: boolean;
}

/** Один пункт меню. Той самий компонент для нижньої панелі, бічної панелі й попапа «Ще». */
export default function NavItem({
  item,
  isActive,
  variant,
  onClick,
  isExpanded,
  showIndicator = true,
}: NavItemProps) {
  if (variant === "side" || variant === "popup") {
    return (
      <Link
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={variant === "popup" ? popupItemClassName(isActive) : sideItemClassName(isActive)}
      >
        <NavIcon id={item.id} className="size-6 shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  }

  const content = (
    <>
      {isActive && showIndicator ? (
        <span
          aria-hidden="true"
          className="absolute top-0 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-b-[3px] bg-blue"
        />
      ) : null}
      <NavIcon id={item.id} className="size-6" />
      <span>{item.label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-haspopup="dialog"
        aria-expanded={isExpanded}
        className={barItemClassName(isActive)}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={barItemClassName(isActive)}
    >
      {content}
    </Link>
  );
}
