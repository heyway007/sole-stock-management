export const SIZE_LABEL_MAX_LENGTH = 24;

export interface SizeProfileEntry {
  label: string;
  euRange?: string;
  footLength: string;
}

const PARIS_CASTOR_PROFILE = [
  { label: "XS", euRange: "36–37", footLength: "22–22.5 cm" },
  { label: "S", euRange: "37–38", footLength: "23–23.5 cm" },
  { label: "M", euRange: "39–40", footLength: "24–24.5 cm" },
  { label: "L", euRange: "40–41", footLength: "25–25.5 cm" },
  { label: "XL", euRange: "42–43", footLength: "26–26.5 cm" },
  { label: "2XL", euRange: "44–45", footLength: "27–27.5 cm" },
  { label: "3XL", euRange: "45–46", footLength: "28–28.5 cm" },
] as const satisfies readonly SizeProfileEntry[];

const WEAVE_PROFILE = [
  { label: "39", footLength: "23–23.5 cm" },
  { label: "40", footLength: "24–24.5 cm" },
  { label: "41", footLength: "25–25.5 cm" },
  { label: "42", footLength: "26–26.5 cm" },
  { label: "43", footLength: "26.5–27 cm" },
  { label: "44", footLength: "27–27.5 cm" },
  { label: "45", footLength: "28–28.5 cm" },
] as const satisfies readonly SizeProfileEntry[];

const naturalCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function normalizedModelName(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

export function normalizeSizeLabel(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const normalized = String(value)
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleUpperCase();

  if (
    !normalized ||
    [...normalized].length > SIZE_LABEL_MAX_LENGTH ||
    /[\p{Cc}\p{Cf}]/u.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function sizeProfileForModel(
  modelName: string,
): readonly SizeProfileEntry[] {
  const model = normalizedModelName(modelName);

  if (model === "PARIS" || model === "CASTOR") {
    return PARIS_CASTOR_PROFILE;
  }

  if (model === "WEAVE") {
    return WEAVE_PROFILE;
  }

  return [];
}

export function formatSizeOption(modelName: string, size: string): string {
  const entry = sizeProfileForModel(modelName).find(
    (candidate) => candidate.label === size,
  );

  if (!entry) return size;

  return entry.euRange
    ? `${entry.label} — EU ${entry.euRange} · ${entry.footLength}`
    : `${entry.label} — ${entry.footLength}`;
}

export function compareSizeLabels(
  modelName: string,
  left: string,
  right: string,
): number {
  const labels = sizeProfileForModel(modelName).map((entry) => entry.label);
  const leftIndex = labels.indexOf(left);
  const rightIndex = labels.indexOf(right);

  if (leftIndex >= 0 || rightIndex >= 0) {
    if (leftIndex < 0) return 1;
    if (rightIndex < 0) return -1;
    return leftIndex - rightIndex;
  }

  return naturalCollator.compare(left, right);
}
