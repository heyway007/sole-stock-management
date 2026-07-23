const MAX_UNIT_PRICE_MINOR = 999_999_999_999;

const BAHT_FORMATTER = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function amountToMinor(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
  if (Math.abs(scaled - rounded) > tolerance || rounded > MAX_UNIT_PRICE_MINOR) {
    return null;
  }
  return rounded;
}

export function parseUnitPriceInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return amountToMinor(amount) === null ? null : amount;
}

export function lineTotalMinor(
  quantity: number,
  unitPrice: number | null,
): number | null {
  const unitMinor = amountToMinor(unitPrice);
  if (!Number.isInteger(quantity) || quantity <= 0 || unitMinor === null) {
    return null;
  }
  const total = quantity * unitMinor;
  return Number.isSafeInteger(total) ? total : null;
}

export function formatBahtMinor(value: number | null): string {
  return value === null ? "—" : `${BAHT_FORMATTER.format(value / 100)} บาท`;
}
