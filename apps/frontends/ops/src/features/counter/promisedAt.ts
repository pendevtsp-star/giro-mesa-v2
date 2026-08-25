export function splitPromisedAt(value: string | null | undefined) {
  if (!value) return { date: "", time: "" };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
  return {
    date: `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`,
    time: `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`,
  };
}

export function promisedAtToIso(date: string, time: string) {
  if (!date.trim() && !time.trim()) return null;
  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const brazilianDateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if ((!isoDateMatch && !brazilianDateMatch) || !timeMatch)
    throw new Error("Informe uma data e hora válidas.");
  const [, first, second, third] = isoDateMatch ?? brazilianDateMatch ?? [];
  const [yearText, monthText, dayText] = isoDateMatch
    ? [first, second, third]
    : [third, second, first];
  const [, hourText, minuteText] = timeMatch;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const parsed = new Date(year, month - 1, day, hour, minute);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    throw new Error("Informe uma data e hora válidas.");
  }
  return parsed.toISOString();
}

export function quickOrderPromisedAtToIso(date: string, time: string, now = Date.now()) {
  const promisedAt = promisedAtToIso(date, time);
  if (promisedAt && new Date(promisedAt).getTime() < now - 60_000) {
    throw new Error("O prazo precisa ser agora ou no futuro.");
  }
  return promisedAt;
}
