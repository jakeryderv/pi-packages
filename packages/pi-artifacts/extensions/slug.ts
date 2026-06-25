const NON_ALPHANUMERIC = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

export function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, "-")
    .replace(EDGE_DASHES, "");

  return slug || "artifact";
}

export function suffixSlug(base: string, index: number): string {
  return index <= 1 ? base : `${base}-${index}`;
}
