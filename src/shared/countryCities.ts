/** Launch countries from the plan + dynamic city directories (zeros when empty). */
export const LAUNCH_COUNTRY_CITIES: Record<string, string[]> = {
  PK: ["Sialkot", "Lahore", "Islamabad", "Karachi", "Faisalabad", "Multan", "Rawalpindi", "Peshawar"],
  AE: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Al Ain"],
  GB: ["London", "Manchester", "Birmingham", "Leeds", "Glasgow"],
  US: ["New York", "Los Angeles", "Chicago", "Houston", "Dallas"],
  SA: ["Riyadh", "Jeddah", "Dammam", "Mecca"],
  QA: ["Doha", "Al Rayyan"],
  TR: ["Istanbul", "Ankara", "Izmir"],
  JP: ["Tokyo", "Osaka", "Kyoto", "Yokohama"],
  IR: ["Tehran", "Isfahan", "Shiraz"],
};

export function citiesForCountry(country?: string | null): string[] {
  const code = (country || "PK").toUpperCase();
  return LAUNCH_COUNTRY_CITIES[code] || LAUNCH_COUNTRY_CITIES.PK;
}
