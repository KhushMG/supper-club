export type Profile = {
  id: string;
  name: string;
  email: string;
  provider: "google";
};
export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}
