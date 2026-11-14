import { LABEL_FORMAT_NAMES, LABEL_FORMATS } from "@/constants/boxes";
import MainButton from "../shared/buttons/MainButton";
import CustomizedInput from "../shared/customizedInput/CustomizedInput";
import CustomizedSelect from "../shared/customizedSelect/CustomizedSelect";
import Disclosure from "../shared/disclosure/Disclosure";

interface LabelsPdfFormProps {
  /** Коди для друку через кому; для пробного аркуша порожньо. */
  codes?: string;
  /** Пробний аркуш: рамки й напис TEST, щоб підібрати зсув принтера. */
  test?: boolean;
  label: string;
}

/**
 * Відкриває PDF з наклейками в новій вкладці. Звичайна форма GET без скриптів: формат наклейок і
 * зсув друку в міліметрах (кожен принтер зсуває друк по-своєму, тому є пробний аркуш).
 */
export default function LabelsPdfForm({ codes = "", test = false, label }: LabelsPdfFormProps) {
  return (
    <form action="/api/boxes/labels" method="get" target="_blank" className="flex flex-col gap-4">
      {test ? (
        <input type="hidden" name="test" value="1" />
      ) : (
        <input type="hidden" name="codes" value={codes} />
      )}
      <CustomizedSelect
        name="format"
        label="Формат наклейок"
        options={LABEL_FORMATS.map((value) => ({ value, label: LABEL_FORMAT_NAMES[value] }))}
        defaultValue="sheet_3x8"
      />
      <Disclosure variant="plain" summary="Зсув друку, якщо наклейки вирівняно не по центру">
        <div className="grid grid-cols-2 gap-4">
          <CustomizedInput
            name="dx"
            label="Вправо, мм"
            inputMode="decimal"
            defaultValue="0"
            hint="Від'ємне: вліво."
          />
          <CustomizedInput
            name="dy"
            label="Вниз, мм"
            inputMode="decimal"
            defaultValue="0"
            hint="Від'ємне: вгору."
          />
        </div>
      </Disclosure>
      <MainButton type="submit" variant={test ? "outline" : "fill"}>
        {label}
      </MainButton>
    </form>
  );
}
