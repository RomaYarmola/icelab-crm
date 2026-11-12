import { ORDER_STATUS_LABELS, type OrderStatus } from "@/constants/constants";
import ButtonLink from "../shared/buttons/ButtonLink";
import IconButton from "../shared/buttons/IconButton";
import MainButton from "../shared/buttons/MainButton";
import Card from "../shared/cards/Card";
import Chip from "../shared/chips/Chip";
import StatusChip from "../shared/chips/StatusChip";
import Tag from "../shared/chips/Tag";
import Container from "../shared/container/Container";
import Checkbox from "../shared/customizedInput/Checkbox";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import PhoneField from "../shared/customizedInput/PhoneField";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import DetailList from "../shared/detailList/DetailList";
import Disclosure from "../shared/disclosure/Disclosure";
import EmptyState from "../shared/emptyState/EmptyState";
import ErrorState from "../shared/errorState/ErrorState";
import Form from "../shared/form/Form";
import BoxIcon from "../shared/icons/BoxIcon";
import CloseIcon from "../shared/icons/CloseIcon";
import MoreIcon from "../shared/icons/MoreIcon";
import OrdersIcon from "../shared/icons/OrdersIcon";
import BackLink from "../shared/links/BackLink";
import MainLink from "../shared/links/MainLink";
import Loader from "../shared/loader/Loader";
import Logo from "../shared/logo/Logo";
import Notification from "../shared/notification/Notification";
import TabLinks from "../shared/tabs/TabLinks";
import SearchDemo from "./SearchDemo";
import LocationSelectDemo from "./LocationSelectDemo";
import PopupDemo from "./PopupDemo";
import Text from "../shared/texts/Text";
import PageTitle from "../shared/titles/PageTitle";
import SectionTitle from "../shared/titles/SectionTitle";
import SubTitle from "../shared/titles/SubTitle";

const COLORS = [
  ["white", "#ffffff"],
  ["navy", "#001731"],
  ["blue", "#1256a3"],
  ["blue-light", "#a8d0fd"],
  ["logo-blue", "#294374"],
  ["grey-light", "#f2f5fa"],
  ["grey-border", "#dce3ed"],
  ["grey-field", "#74839a"],
  ["grey-text", "#44546a"],
  ["red-error", "#b3261e"],
] as const;

const STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-grey-border pt-8">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

/**
 * Каталог компонентів: усі «цеглинки» інтерфейсу в одному місці. Лише для розробки
 * (`/ui-kit` у збірці закрито). Новий компонент спершу додаємо сюди.
 */
export default function UiKitContent() {
  return (
    <Container className="flex flex-col gap-10 py-10">
      <div className="flex flex-col gap-3">
        <Logo />
        <PageTitle>Каталог компонентів IceLab CRM</PageTitle>
        <Text variant="muted">
          Варіант В «Мінімалістичний». Кольори, розміри тексту, закруглення і брейкпоінти задаються
          в <code>globals.css</code>. Змініть значення там, і зміниться скрізь.
        </Text>
      </div>

      <Block title="Кольори">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {COLORS.map(([name, hex]) => (
            <div key={name} className="flex flex-col gap-1">
              <div
                className="h-14 rounded-field border border-grey-border"
                style={{ background: hex }}
              />
              <Text variant="label">{name}</Text>
              <Text variant="muted">{hex}</Text>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Типографіка">
        <div className="flex flex-col gap-3">
          <PageTitle>Заголовок сторінки (h1)</PageTitle>
          <SectionTitle>Заголовок розділу (h2)</SectionTitle>
          <SubTitle>Підзаголовок, назва картки (h3)</SubTitle>
          <Text variant="lead">Виділений текст, суми (lead)</Text>
          <Text>Основний текст від 16 px (body): Кафе «Вогник», 30 кг, самовивіз.</Text>
          <Text variant="muted">Другорядний текст (muted): АА15 · № 3472</Text>
          <Text variant="label">Підпис поля (label)</Text>
          <Text variant="error">Текст помилки (error)</Text>
          <Text variant="kpi">Виготовити 33 кг (kpi)</Text>
        </div>
      </Block>

      <Block title="Кнопки">
        <div className="flex max-w-sm flex-col gap-3">
          <MainButton>Основна (fill)</MainButton>
          <MainButton variant="accent">Акцентна (accent)</MainButton>
          <MainButton variant="outline">Контурна (outline)</MainButton>
          <MainButton variant="ghost">Прозора (ghost)</MainButton>
          <MainButton size="sm">Менша (sm, від 44 px)</MainButton>
          <MainButton isLoading>Збереження</MainButton>
          <MainButton disabled>Недоступна</MainButton>
          <MainButton icon={<OrdersIcon className="size-6" />}>З іконкою</MainButton>
          <ButtonLink href="/ui-kit" variant="outline">
            Посилання у вигляді кнопки
          </ButtonLink>
          <div className="flex items-center gap-2">
            <IconButton label="Ще">
              <MoreIcon className="size-6" />
            </IconButton>
            <IconButton label="Закрити">
              <CloseIcon className="size-6" />
            </IconButton>
          </div>
        </div>
      </Block>

      <Block title="Посилання">
        <BackLink href="/ui-kit">Користувачі</BackLink>
        <Text>
          Текст із <MainLink href="/ui-kit">посиланням усередині</MainLink> і{" "}
          <MainLink href="https://icelab.com.ua" isExternal>
            зовнішнім посиланням
          </MainLink>
          .
        </Text>
      </Block>

      <Block title="Форми і поля">
        <Form className="max-w-sm">
          <CustomizedInput name="demo-name" label="Назва" placeholder="Кафе «Вогник»" />
          <CustomizedInput
            name="demo-phone"
            label="Телефон"
            type="tel"
            hint="Формат: +380 50 000 00 00"
            placeholder="+380"
          />
          <CustomizedInput
            name="demo-email"
            label="E-mail"
            type="email"
            defaultValue="name@"
            error="Введіть коректну адресу, наприклад name@example.com"
          />
          <CustomizedInput
            name="demo-password"
            type="password"
            label="Пароль"
            hint="Кнопка справа показує або ховає пароль"
            defaultValue="demo-password"
          />
          <CustomizedSelect
            name="demo-role"
            label="Роль"
            options={[
              { value: "manager", label: "Менеджер" },
              { value: "location_lead", label: "Старший локації" },
              { value: "accountant", label: "Бухгалтер" },
            ]}
            hint="Нативний список: на телефоні відкривається системним вибирачем"
          />
          <CustomizedSelect
            name="demo-role-error"
            label="Локація"
            options={[
              { value: "", label: "Оберіть локацію" },
              { value: "kyiv", label: "Київ" },
              { value: "lviv", label: "Львів" },
            ]}
            error="Для цієї ролі потрібно вибрати локацію."
          />
          <PhoneField
            name="demo-phone-field"
            label="Телефон з форматуванням"
            hint="Введіть 0501234567 і перейдіть далі: номер стане «+38 050 123 45 67»"
          />
          <Checkbox
            name="demo-primary"
            label="Основний контакт"
            hint="Зона натискання 44 px: клікабельний увесь рядок"
            defaultChecked
          />
          <CustomizedInput name="demo-note" label="Коментар" as="textarea" placeholder="Нотатка" />
          <CustomizedInput
            name="demo-off"
            label="Недоступне поле"
            disabled
            defaultValue="Лише читання"
          />
        </Form>
      </Block>

      <Block title="Плашки і фільтри">
        <div className="flex flex-wrap gap-1.5">
          <Chip selected>Сьогодні</Chip>
          <Chip>Вчора</Chip>
          <Chip>Завтра</Chip>
          <Chip>Тиждень</Chip>
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <StatusChip key={status} status={status} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Tag>Київ</Tag>
          <Tag>Усі локації</Tag>
          <Tag variant="plain">Київ (підпис без рамки)</Tag>
          <LocationSelectDemo />
        </div>
      </Block>

      <Block title="Пошук, фільтри, «Показати ще»">
        <SearchDemo />
      </Block>

      <Block title="Вкладки і розкривні блоки">
        <div className="flex max-w-xl flex-col gap-4">
          <TabLinks
            label="Приклад вкладок"
            activeId="contacts"
            items={[
              { id: "main", label: "Основне", href: "/ui-kit" },
              { id: "contacts", label: "Контакти", href: "/ui-kit" },
              { id: "addresses", label: "Адреси", href: "/ui-kit" },
              { id: "prices", label: "Ціни", href: "/ui-kit" },
            ]}
          />
          <Disclosure summary="Додати контакт">
            <Text variant="muted">Вміст, що розкривається. Стрілка розвертається.</Text>
          </Disclosure>
          <Disclosure variant="plain" summary="Історія цін">
            <Text variant="muted">Те саме без рамки: для другорядних деталей.</Text>
          </Disclosure>
        </div>
      </Block>

      <Block title="Перелік «назва: значення»">
        <Card className="max-w-xl">
          <DetailList
            items={[
              { label: "Тип клієнта", value: "ФОП" },
              { label: "Менеджер", value: "Олена Коваль" },
              { label: "ЄДРПОУ або ІПН", value: null },
              { label: "Примітка", value: "Просить привозити до 10:00." },
            ]}
          />
        </Card>
      </Block>

      <Block title="Картки">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="flex flex-col gap-1">
            <SubTitle>Кафе «Вогник»</SubTitle>
            <Text variant="muted">АА15 · № 3472</Text>
            <Text>30 кг · Гранули · Самовивіз</Text>
          </Card>
          <Card interactive className="flex flex-col gap-1">
            <SubTitle>Клікабельна картка</SubTitle>
            <Text variant="muted">Рамка підсвічується при наведенні (від lg)</Text>
          </Card>
        </div>
      </Block>

      <Block title="Повідомлення">
        <div className="flex max-w-xl flex-col gap-3">
          <Notification variant="info" title="Інформація">
            Нове замовлення зберігається як чернетка.
          </Notification>
          <Notification variant="success">Зміни збережено.</Notification>
          <Notification variant="warning" title="Немає зв’язку">
            Показано збережене.
          </Notification>
          <Notification
            variant="error"
            action={
              <MainButton variant="outline" size="sm" fullWidth={false}>
                Повторити
              </MainButton>
            }
          >
            Невірний e-mail або пароль.
          </Notification>
        </div>
      </Block>

      <Block title="Попап">
        <PopupDemo />
      </Block>

      <Block title="Порожній стан, помилка, завантаження">
        <div className="grid gap-4 lg:grid-cols-2">
          <EmptyState
            icon={<BoxIcon />}
            title="Боксів на цю дату немає"
            description="Створіть перше замовлення, щоб бокси з’явилися тут."
            action={<MainButton>Нове замовлення</MainButton>}
          />
          {/* Кнопка «Повторити» з'являється, коли передано onRetry (це робить error.tsx). */}
          <ErrorState />
        </div>
        <Loader className="min-h-24" />
      </Block>
    </Container>
  );
}
