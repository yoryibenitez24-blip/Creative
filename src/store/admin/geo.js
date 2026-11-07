// Approximate visitor location without any network service: the browser's IANA time zone (Intl) and language tag are
// mapped to a country and a representative city point with the built-in tables below. Accuracy is "which country,
// roughly which part of it" — good enough for a visitor globe, never for anything precise. Pure, no dependencies.

/** ISO 3166-1 alpha-2 → [name, lat, lon] (approximate geographic centre / main population area). Also the whitelist. */
export const COUNTRY_GEO = {
  AD: ['Andorra', 42.5, 1.5], AE: ['United Arab Emirates', 24.2, 54.4], AF: ['Afghanistan', 33.9, 67.7], AG: ['Antigua and Barbuda', 17.1, -61.8],
  AL: ['Albania', 41.2, 20.2], AM: ['Armenia', 40.1, 45.0], AO: ['Angola', -11.2, 17.9], AR: ['Argentina', -34.6, -64.0], AT: ['Austria', 47.5, 14.6],
  AU: ['Australia', -25.3, 133.8], AZ: ['Azerbaijan', 40.1, 47.6], BA: ['Bosnia and Herzegovina', 43.9, 17.7], BB: ['Barbados', 13.2, -59.5],
  BD: ['Bangladesh', 23.7, 90.4], BE: ['Belgium', 50.5, 4.5], BF: ['Burkina Faso', 12.2, -1.6], BG: ['Bulgaria', 42.7, 25.5], BH: ['Bahrain', 26.0, 50.6],
  BI: ['Burundi', -3.4, 29.9], BJ: ['Benin', 9.3, 2.3], BN: ['Brunei', 4.5, 114.7], BO: ['Bolivia', -16.3, -63.6], BR: ['Brazil', -14.2, -51.9],
  BS: ['Bahamas', 25.0, -77.4], BT: ['Bhutan', 27.5, 90.4], BW: ['Botswana', -22.3, 24.7], BY: ['Belarus', 53.7, 28.0], BZ: ['Belize', 17.2, -88.5],
  CA: ['Canada', 56.1, -106.3], CD: ['DR Congo', -4.0, 21.8], CF: ['Central African Republic', 6.6, 20.9], CG: ['Congo', -0.2, 15.8], CH: ['Switzerland', 46.8, 8.2],
  CI: ['Côte d’Ivoire', 7.5, -5.5], CL: ['Chile', -35.7, -71.5], CM: ['Cameroon', 7.4, 12.4], CN: ['China', 35.9, 104.2], CO: ['Colombia', 4.6, -74.3],
  CR: ['Costa Rica', 9.7, -83.8], CU: ['Cuba', 21.5, -77.8], CV: ['Cape Verde', 16.0, -24.0], CY: ['Cyprus', 35.1, 33.4], CZ: ['Czechia', 49.8, 15.5],
  DE: ['Germany', 51.2, 10.5], DJ: ['Djibouti', 11.8, 42.6], DK: ['Denmark', 56.3, 9.5], DM: ['Dominica', 15.4, -61.4], DO: ['Dominican Republic', 18.7, -70.2],
  DZ: ['Algeria', 28.0, 1.7], EC: ['Ecuador', -1.8, -78.2], EE: ['Estonia', 58.6, 25.0], EG: ['Egypt', 26.8, 30.8], ER: ['Eritrea', 15.2, 39.8],
  ES: ['Spain', 40.5, -3.7], ET: ['Ethiopia', 9.1, 40.5], FI: ['Finland', 61.9, 25.7], FJ: ['Fiji', -17.7, 178.1], FR: ['France', 46.2, 2.2],
  GA: ['Gabon', -0.8, 11.6], GB: ['United Kingdom', 54.0, -2.0], GD: ['Grenada', 12.1, -61.7], GE: ['Georgia', 42.3, 43.4], GH: ['Ghana', 7.9, -1.0],
  GL: ['Greenland', 71.7, -42.6], GM: ['Gambia', 13.4, -15.3], GN: ['Guinea', 9.9, -9.7], GQ: ['Equatorial Guinea', 1.7, 10.3], GR: ['Greece', 39.1, 21.8],
  GT: ['Guatemala', 15.8, -90.2], GW: ['Guinea-Bissau', 11.8, -15.2], GY: ['Guyana', 4.9, -58.9], HK: ['Hong Kong', 22.3, 114.2], HN: ['Honduras', 15.2, -86.2],
  HR: ['Croatia', 45.1, 15.2], HT: ['Haiti', 19.0, -72.3], HU: ['Hungary', 47.2, 19.5], ID: ['Indonesia', -0.8, 113.9], IE: ['Ireland', 53.4, -8.2],
  IL: ['Israel', 31.0, 34.9], IN: ['India', 20.6, 79.0], IQ: ['Iraq', 33.2, 43.7], IR: ['Iran', 32.4, 53.7], IS: ['Iceland', 64.9, -19.0],
  IT: ['Italy', 41.9, 12.6], JM: ['Jamaica', 18.1, -77.3], JO: ['Jordan', 30.6, 36.2], JP: ['Japan', 36.2, 138.3], KE: ['Kenya', -0.0, 37.9],
  KG: ['Kyrgyzstan', 41.2, 74.8], KH: ['Cambodia', 12.6, 104.9], KN: ['Saint Kitts and Nevis', 17.3, -62.7], KR: ['South Korea', 35.9, 127.8], KW: ['Kuwait', 29.3, 47.5],
  KZ: ['Kazakhstan', 48.0, 66.9], LA: ['Laos', 19.9, 102.5], LB: ['Lebanon', 33.9, 35.9], LC: ['Saint Lucia', 13.9, -61.0], LI: ['Liechtenstein', 47.2, 9.6],
  LK: ['Sri Lanka', 7.9, 80.8], LR: ['Liberia', 6.4, -9.4], LS: ['Lesotho', -29.6, 28.2], LT: ['Lithuania', 55.2, 23.9], LU: ['Luxembourg', 49.8, 6.1],
  LV: ['Latvia', 56.9, 24.6], LY: ['Libya', 26.3, 17.2], MA: ['Morocco', 31.8, -7.1], MC: ['Monaco', 43.7, 7.4], MD: ['Moldova', 47.4, 28.4],
  ME: ['Montenegro', 42.7, 19.4], MG: ['Madagascar', -18.8, 46.9], MK: ['North Macedonia', 41.6, 21.7], ML: ['Mali', 17.6, -4.0], MM: ['Myanmar', 21.9, 96.0],
  MN: ['Mongolia', 46.9, 103.8], MO: ['Macao', 22.2, 113.5], MR: ['Mauritania', 21.0, -10.9], MT: ['Malta', 35.9, 14.4], MU: ['Mauritius', -20.3, 57.6],
  MV: ['Maldives', 3.2, 73.2], MW: ['Malawi', -13.3, 34.3], MX: ['Mexico', 23.6, -102.6], MY: ['Malaysia', 4.2, 102.0], MZ: ['Mozambique', -18.7, 35.5],
  NA: ['Namibia', -22.9, 18.5], NE: ['Niger', 17.6, 8.1], NG: ['Nigeria', 9.1, 8.7], NI: ['Nicaragua', 12.9, -85.2], NL: ['Netherlands', 52.1, 5.3],
  NO: ['Norway', 60.5, 8.5], NP: ['Nepal', 28.4, 84.1], NZ: ['New Zealand', -40.9, 174.9], OM: ['Oman', 21.5, 55.9], PA: ['Panama', 8.5, -80.8],
  PE: ['Peru', -9.2, -75.0], PG: ['Papua New Guinea', -6.3, 143.9], PH: ['Philippines', 12.9, 121.8], PK: ['Pakistan', 30.4, 69.3], PL: ['Poland', 51.9, 19.1],
  PR: ['Puerto Rico', 18.2, -66.6], PS: ['Palestine', 31.9, 35.2], PT: ['Portugal', 39.4, -8.2], PY: ['Paraguay', -23.4, -58.4], QA: ['Qatar', 25.4, 51.2],
  RO: ['Romania', 45.9, 25.0], RS: ['Serbia', 44.0, 21.0], RU: ['Russia', 55.8, 37.6], RW: ['Rwanda', -1.9, 29.9], SA: ['Saudi Arabia', 23.9, 45.1],
  SB: ['Solomon Islands', -9.6, 160.2], SC: ['Seychelles', -4.7, 55.5], SD: ['Sudan', 12.9, 30.2], SE: ['Sweden', 60.1, 18.6], SG: ['Singapore', 1.35, 103.8],
  SI: ['Slovenia', 46.2, 14.995], SK: ['Slovakia', 48.7, 19.7], SL: ['Sierra Leone', 8.5, -11.8], SM: ['San Marino', 43.9, 12.5], SN: ['Senegal', 14.5, -14.5],
  SO: ['Somalia', 5.2, 46.2], SR: ['Suriname', 3.9, -56.0], SS: ['South Sudan', 6.9, 31.3], SV: ['El Salvador', 13.8, -88.9], SY: ['Syria', 34.8, 39.0],
  SZ: ['Eswatini', -26.5, 31.5], TD: ['Chad', 15.5, 18.7], TG: ['Togo', 8.6, 0.8], TH: ['Thailand', 15.9, 100.99], TJ: ['Tajikistan', 38.9, 71.3],
  TL: ['Timor-Leste', -8.9, 125.7], TM: ['Turkmenistan', 38.97, 59.6], TN: ['Tunisia', 33.9, 9.5], TO: ['Tonga', -21.2, -175.2], TR: ['Türkiye', 39.0, 35.2],
  TT: ['Trinidad and Tobago', 10.7, -61.2], TW: ['Taiwan', 23.7, 121.0], TZ: ['Tanzania', -6.4, 34.9], UA: ['Ukraine', 48.4, 31.2], UG: ['Uganda', 1.4, 32.3],
  US: ['United States', 39.8, -98.6], UY: ['Uruguay', -32.5, -55.8], UZ: ['Uzbekistan', 41.4, 64.6], VC: ['Saint Vincent and the Grenadines', 13.0, -61.2],
  VE: ['Venezuela', 6.4, -66.6], VN: ['Vietnam', 14.1, 108.3], VU: ['Vanuatu', -15.4, 166.96], WS: ['Samoa', -13.8, -172.1], XK: ['Kosovo', 42.6, 20.9],
  YE: ['Yemen', 15.6, 48.5], ZA: ['South Africa', -30.6, 22.9], ZM: ['Zambia', -13.1, 27.8], ZW: ['Zimbabwe', -19.0, 29.2],
};

/** IANA time zone → [country, city, lat, lon]. Covers the zones browsers report for most of the world's population. */
export const TZ_GEO = {
  // North America
  'America/New_York': ['US', 'New York', 40.7, -74.0], 'America/Detroit': ['US', 'Detroit', 42.3, -83.0], 'America/Chicago': ['US', 'Chicago', 41.9, -87.6],
  'America/Denver': ['US', 'Denver', 39.7, -105.0], 'America/Phoenix': ['US', 'Phoenix', 33.4, -112.1], 'America/Los_Angeles': ['US', 'Los Angeles', 34.1, -118.2],
  'America/Anchorage': ['US', 'Anchorage', 61.2, -149.9], 'Pacific/Honolulu': ['US', 'Honolulu', 21.3, -157.9], 'America/Boise': ['US', 'Boise', 43.6, -116.2],
  'America/Indiana/Indianapolis': ['US', 'Indianapolis', 39.8, -86.2], 'America/Kentucky/Louisville': ['US', 'Louisville', 38.3, -85.8],
  'America/Toronto': ['CA', 'Toronto', 43.7, -79.4], 'America/Montreal': ['CA', 'Montréal', 45.5, -73.6], 'America/Vancouver': ['CA', 'Vancouver', 49.3, -123.1],
  'America/Edmonton': ['CA', 'Edmonton', 53.5, -113.5], 'America/Winnipeg': ['CA', 'Winnipeg', 49.9, -97.1], 'America/Halifax': ['CA', 'Halifax', 44.6, -63.6],
  'America/Regina': ['CA', 'Regina', 50.4, -104.6], 'America/St_Johns': ['CA', 'St. John’s', 47.6, -52.7],
  'America/Mexico_City': ['MX', 'Mexico City', 19.4, -99.1], 'America/Monterrey': ['MX', 'Monterrey', 25.7, -100.3], 'America/Tijuana': ['MX', 'Tijuana', 32.5, -117.0],
  'America/Cancun': ['MX', 'Cancún', 21.2, -86.8], 'America/Merida': ['MX', 'Mérida', 21.0, -89.6], 'America/Hermosillo': ['MX', 'Hermosillo', 29.1, -111.0],
  'America/Guatemala': ['GT', 'Guatemala City', 14.6, -90.5], 'America/El_Salvador': ['SV', 'San Salvador', 13.7, -89.2], 'America/Tegucigalpa': ['HN', 'Tegucigalpa', 14.1, -87.2],
  'America/Managua': ['NI', 'Managua', 12.1, -86.3], 'America/Costa_Rica': ['CR', 'San José', 9.9, -84.1], 'America/Panama': ['PA', 'Panama City', 9.0, -79.5],
  'America/Belize': ['BZ', 'Belize City', 17.5, -88.2], 'America/Havana': ['CU', 'Havana', 23.1, -82.4], 'America/Jamaica': ['JM', 'Kingston', 18.0, -76.8],
  'America/Santo_Domingo': ['DO', 'Santo Domingo', 18.5, -69.9], 'America/Port-au-Prince': ['HT', 'Port-au-Prince', 18.5, -72.3], 'America/Puerto_Rico': ['PR', 'San Juan', 18.5, -66.1],
  'America/Nassau': ['BS', 'Nassau', 25.0, -77.3], 'America/Barbados': ['BB', 'Bridgetown', 13.1, -59.6], 'America/Port_of_Spain': ['TT', 'Port of Spain', 10.7, -61.5],
  // South America
  'America/Sao_Paulo': ['BR', 'São Paulo', -23.6, -46.6], 'America/Bahia': ['BR', 'Salvador', -13.0, -38.5], 'America/Fortaleza': ['BR', 'Fortaleza', -3.7, -38.5],
  'America/Recife': ['BR', 'Recife', -8.1, -34.9], 'America/Belem': ['BR', 'Belém', -1.5, -48.5], 'America/Manaus': ['BR', 'Manaus', -3.1, -60.0],
  'America/Cuiaba': ['BR', 'Cuiabá', -15.6, -56.1], 'America/Argentina/Buenos_Aires': ['AR', 'Buenos Aires', -34.6, -58.4], 'America/Buenos_Aires': ['AR', 'Buenos Aires', -34.6, -58.4],
  'America/Argentina/Cordoba': ['AR', 'Córdoba', -31.4, -64.2], 'America/Santiago': ['CL', 'Santiago', -33.4, -70.7], 'America/Lima': ['PE', 'Lima', -12.0, -77.0],
  'America/Bogota': ['CO', 'Bogotá', 4.7, -74.1], 'America/Caracas': ['VE', 'Caracas', 10.5, -66.9], 'America/Guayaquil': ['EC', 'Guayaquil', -2.2, -79.9],
  'America/La_Paz': ['BO', 'La Paz', -16.5, -68.1], 'America/Asuncion': ['PY', 'Asunción', -25.3, -57.6], 'America/Montevideo': ['UY', 'Montevideo', -34.9, -56.2],
  'America/Guyana': ['GY', 'Georgetown', 6.8, -58.2], 'America/Paramaribo': ['SR', 'Paramaribo', 5.9, -55.2], 'America/Nuuk': ['GL', 'Nuuk', 64.2, -51.7], 'America/Godthab': ['GL', 'Nuuk', 64.2, -51.7],
  // Europe
  'Europe/London': ['GB', 'London', 51.5, -0.1], 'Europe/Dublin': ['IE', 'Dublin', 53.3, -6.3], 'Europe/Lisbon': ['PT', 'Lisbon', 38.7, -9.1],
  'Atlantic/Madeira': ['PT', 'Funchal', 32.7, -16.9], 'Atlantic/Azores': ['PT', 'Ponta Delgada', 37.7, -25.7], 'Atlantic/Canary': ['ES', 'Las Palmas', 28.1, -15.4],
  'Atlantic/Reykjavik': ['IS', 'Reykjavík', 64.1, -21.9], 'Europe/Madrid': ['ES', 'Madrid', 40.4, -3.7], 'Europe/Paris': ['FR', 'Paris', 48.9, 2.35],
  'Europe/Brussels': ['BE', 'Brussels', 50.85, 4.35], 'Europe/Amsterdam': ['NL', 'Amsterdam', 52.4, 4.9], 'Europe/Luxembourg': ['LU', 'Luxembourg', 49.6, 6.1],
  'Europe/Berlin': ['DE', 'Berlin', 52.5, 13.4], 'Europe/Busingen': ['DE', 'Büsingen', 47.7, 8.7], 'Europe/Zurich': ['CH', 'Zürich', 47.4, 8.5], 'Europe/Vienna': ['AT', 'Vienna', 48.2, 16.4],
  'Europe/Rome': ['IT', 'Rome', 41.9, 12.5], 'Europe/Monaco': ['MC', 'Monaco', 43.7, 7.4], 'Europe/Malta': ['MT', 'Valletta', 35.9, 14.5], 'Europe/Andorra': ['AD', 'Andorra la Vella', 42.5, 1.5],
  'Europe/Copenhagen': ['DK', 'Copenhagen', 55.7, 12.6], 'Europe/Oslo': ['NO', 'Oslo', 59.9, 10.8], 'Europe/Stockholm': ['SE', 'Stockholm', 59.3, 18.1],
  'Europe/Helsinki': ['FI', 'Helsinki', 60.2, 24.9], 'Europe/Tallinn': ['EE', 'Tallinn', 59.4, 24.8], 'Europe/Riga': ['LV', 'Riga', 56.9, 24.1],
  'Europe/Vilnius': ['LT', 'Vilnius', 54.7, 25.3], 'Europe/Warsaw': ['PL', 'Warsaw', 52.2, 21.0], 'Europe/Prague': ['CZ', 'Prague', 50.1, 14.4],
  'Europe/Bratislava': ['SK', 'Bratislava', 48.1, 17.1], 'Europe/Budapest': ['HU', 'Budapest', 47.5, 19.0], 'Europe/Ljubljana': ['SI', 'Ljubljana', 46.1, 14.5],
  'Europe/Zagreb': ['HR', 'Zagreb', 45.8, 16.0], 'Europe/Belgrade': ['RS', 'Belgrade', 44.8, 20.5], 'Europe/Sarajevo': ['BA', 'Sarajevo', 43.9, 18.4],
  'Europe/Podgorica': ['ME', 'Podgorica', 42.4, 19.3], 'Europe/Skopje': ['MK', 'Skopje', 42.0, 21.4], 'Europe/Tirane': ['AL', 'Tirana', 41.3, 19.8],
  'Europe/Athens': ['GR', 'Athens', 38.0, 23.7], 'Europe/Sofia': ['BG', 'Sofia', 42.7, 23.3], 'Europe/Bucharest': ['RO', 'Bucharest', 44.4, 26.1],
  'Europe/Chisinau': ['MD', 'Chișinău', 47.0, 28.9], 'Europe/Kiev': ['UA', 'Kyiv', 50.45, 30.5], 'Europe/Kyiv': ['UA', 'Kyiv', 50.45, 30.5],
  'Europe/Minsk': ['BY', 'Minsk', 53.9, 27.6], 'Europe/Moscow': ['RU', 'Moscow', 55.8, 37.6], 'Europe/Samara': ['RU', 'Samara', 53.2, 50.1],
  'Europe/Kaliningrad': ['RU', 'Kaliningrad', 54.7, 20.5], 'Europe/Istanbul': ['TR', 'Istanbul', 41.0, 29.0], 'Asia/Istanbul': ['TR', 'Istanbul', 41.0, 29.0],
  'Asia/Nicosia': ['CY', 'Nicosia', 35.2, 33.4], 'Europe/Nicosia': ['CY', 'Nicosia', 35.2, 33.4],
  // Russia / Central Asia / Caucasus
  'Asia/Yekaterinburg': ['RU', 'Yekaterinburg', 56.8, 60.6], 'Asia/Omsk': ['RU', 'Omsk', 55.0, 73.4], 'Asia/Novosibirsk': ['RU', 'Novosibirsk', 55.0, 82.9],
  'Asia/Krasnoyarsk': ['RU', 'Krasnoyarsk', 56.0, 92.9], 'Asia/Irkutsk': ['RU', 'Irkutsk', 52.3, 104.3], 'Asia/Yakutsk': ['RU', 'Yakutsk', 62.0, 129.7],
  'Asia/Vladivostok': ['RU', 'Vladivostok', 43.1, 131.9], 'Asia/Magadan': ['RU', 'Magadan', 59.6, 150.8], 'Asia/Kamchatka': ['RU', 'Petropavlovsk', 53.0, 158.6],
  'Asia/Almaty': ['KZ', 'Almaty', 43.2, 76.9], 'Asia/Qostanay': ['KZ', 'Kostanay', 53.2, 63.6], 'Asia/Tashkent': ['UZ', 'Tashkent', 41.3, 69.2], 'Asia/Bishkek': ['KG', 'Bishkek', 42.9, 74.6],
  'Asia/Dushanbe': ['TJ', 'Dushanbe', 38.6, 68.8], 'Asia/Ashgabat': ['TM', 'Ashgabat', 37.95, 58.4], 'Asia/Tbilisi': ['GE', 'Tbilisi', 41.7, 44.8],
  'Asia/Yerevan': ['AM', 'Yerevan', 40.2, 44.5], 'Asia/Baku': ['AZ', 'Baku', 40.4, 49.9], 'Asia/Ulaanbaatar': ['MN', 'Ulaanbaatar', 47.9, 106.9],
  // Middle East
  'Asia/Jerusalem': ['IL', 'Jerusalem', 31.8, 35.2], 'Asia/Tel_Aviv': ['IL', 'Tel Aviv', 32.1, 34.8], 'Asia/Gaza': ['PS', 'Gaza', 31.5, 34.5], 'Asia/Hebron': ['PS', 'Hebron', 31.5, 35.1],
  'Asia/Beirut': ['LB', 'Beirut', 33.9, 35.5], 'Asia/Damascus': ['SY', 'Damascus', 33.5, 36.3], 'Asia/Amman': ['JO', 'Amman', 31.95, 35.9],
  'Asia/Baghdad': ['IQ', 'Baghdad', 33.3, 44.4], 'Asia/Tehran': ['IR', 'Tehran', 35.7, 51.4], 'Asia/Riyadh': ['SA', 'Riyadh', 24.7, 46.7],
  'Asia/Kuwait': ['KW', 'Kuwait City', 29.4, 48.0], 'Asia/Bahrain': ['BH', 'Manama', 26.2, 50.6], 'Asia/Qatar': ['QA', 'Doha', 25.3, 51.5],
  'Asia/Dubai': ['AE', 'Dubai', 25.2, 55.3], 'Asia/Muscat': ['OM', 'Muscat', 23.6, 58.4], 'Asia/Aden': ['YE', 'Aden', 12.8, 45.0], 'Asia/Kabul': ['AF', 'Kabul', 34.5, 69.2],
  // South & East Asia
  'Asia/Karachi': ['PK', 'Karachi', 24.9, 67.0], 'Asia/Kolkata': ['IN', 'Mumbai', 19.1, 72.9], 'Asia/Calcutta': ['IN', 'Kolkata', 22.6, 88.4],
  'Asia/Kathmandu': ['NP', 'Kathmandu', 27.7, 85.3], 'Asia/Katmandu': ['NP', 'Kathmandu', 27.7, 85.3], 'Asia/Thimphu': ['BT', 'Thimphu', 27.5, 89.6],
  'Asia/Dhaka': ['BD', 'Dhaka', 23.8, 90.4], 'Asia/Colombo': ['LK', 'Colombo', 6.9, 79.9], 'Indian/Maldives': ['MV', 'Malé', 4.2, 73.5],
  'Asia/Yangon': ['MM', 'Yangon', 16.9, 96.2], 'Asia/Rangoon': ['MM', 'Yangon', 16.9, 96.2], 'Asia/Bangkok': ['TH', 'Bangkok', 13.8, 100.5],
  'Asia/Ho_Chi_Minh': ['VN', 'Ho Chi Minh City', 10.8, 106.7], 'Asia/Saigon': ['VN', 'Ho Chi Minh City', 10.8, 106.7], 'Asia/Phnom_Penh': ['KH', 'Phnom Penh', 11.6, 104.9],
  'Asia/Vientiane': ['LA', 'Vientiane', 17.97, 102.6], 'Asia/Kuala_Lumpur': ['MY', 'Kuala Lumpur', 3.1, 101.7], 'Asia/Kuching': ['MY', 'Kuching', 1.55, 110.3],
  'Asia/Singapore': ['SG', 'Singapore', 1.35, 103.8], 'Asia/Jakarta': ['ID', 'Jakarta', -6.2, 106.8], 'Asia/Makassar': ['ID', 'Makassar', -5.1, 119.4],
  'Asia/Jayapura': ['ID', 'Jayapura', -2.5, 140.7], 'Asia/Pontianak': ['ID', 'Pontianak', -0.03, 109.3], 'Asia/Brunei': ['BN', 'Bandar Seri Begawan', 4.9, 114.9],
  'Asia/Manila': ['PH', 'Manila', 14.6, 121.0], 'Asia/Dili': ['TL', 'Dili', -8.6, 125.6], 'Asia/Shanghai': ['CN', 'Shanghai', 31.2, 121.5],
  'Asia/Chongqing': ['CN', 'Chongqing', 29.6, 106.5], 'Asia/Urumqi': ['CN', 'Ürümqi', 43.8, 87.6], 'Asia/Hong_Kong': ['HK', 'Hong Kong', 22.3, 114.2],
  'Asia/Macau': ['MO', 'Macao', 22.2, 113.5], 'Asia/Taipei': ['TW', 'Taipei', 25.0, 121.6], 'Asia/Seoul': ['KR', 'Seoul', 37.6, 127.0],
  'Asia/Tokyo': ['JP', 'Tokyo', 35.7, 139.7],
  // Oceania
  'Australia/Sydney': ['AU', 'Sydney', -33.9, 151.2], 'Australia/Melbourne': ['AU', 'Melbourne', -37.8, 145.0], 'Australia/Brisbane': ['AU', 'Brisbane', -27.5, 153.0],
  'Australia/Adelaide': ['AU', 'Adelaide', -34.9, 138.6], 'Australia/Perth': ['AU', 'Perth', -31.95, 115.9], 'Australia/Darwin': ['AU', 'Darwin', -12.5, 130.8],
  'Australia/Hobart': ['AU', 'Hobart', -42.9, 147.3], 'Australia/Canberra': ['AU', 'Canberra', -35.3, 149.1], 'Pacific/Auckland': ['NZ', 'Auckland', -36.85, 174.8],
  'Pacific/Chatham': ['NZ', 'Chatham Islands', -43.95, -176.6], 'Pacific/Fiji': ['FJ', 'Suva', -18.1, 178.4], 'Pacific/Port_Moresby': ['PG', 'Port Moresby', -9.4, 147.2],
  'Pacific/Guadalcanal': ['SB', 'Honiara', -9.4, 159.95], 'Pacific/Efate': ['VU', 'Port Vila', -17.7, 168.3], 'Pacific/Apia': ['WS', 'Apia', -13.8, -171.8],
  'Pacific/Tongatapu': ['TO', 'Nukuʻalofa', -21.1, -175.2],
  // Africa
  'Africa/Cairo': ['EG', 'Cairo', 30.0, 31.2], 'Africa/Casablanca': ['MA', 'Casablanca', 33.6, -7.6], 'Africa/Algiers': ['DZ', 'Algiers', 36.75, 3.06],
  'Africa/Tunis': ['TN', 'Tunis', 36.8, 10.2], 'Africa/Tripoli': ['LY', 'Tripoli', 32.9, 13.2], 'Africa/Khartoum': ['SD', 'Khartoum', 15.5, 32.6],
  'Africa/Juba': ['SS', 'Juba', 4.85, 31.6], 'Africa/Addis_Ababa': ['ET', 'Addis Ababa', 9.0, 38.75], 'Africa/Asmara': ['ER', 'Asmara', 15.3, 38.9],
  'Africa/Djibouti': ['DJ', 'Djibouti', 11.6, 43.1], 'Africa/Mogadishu': ['SO', 'Mogadishu', 2.05, 45.3], 'Africa/Nairobi': ['KE', 'Nairobi', -1.3, 36.8],
  'Africa/Kampala': ['UG', 'Kampala', 0.35, 32.6], 'Africa/Kigali': ['RW', 'Kigali', -1.95, 30.06], 'Africa/Bujumbura': ['BI', 'Bujumbura', -3.4, 29.4],
  'Africa/Dar_es_Salaam': ['TZ', 'Dar es Salaam', -6.8, 39.3], 'Africa/Lagos': ['NG', 'Lagos', 6.5, 3.4], 'Africa/Accra': ['GH', 'Accra', 5.6, -0.2],
  'Africa/Abidjan': ['CI', 'Abidjan', 5.35, -4.0], 'Africa/Dakar': ['SN', 'Dakar', 14.7, -17.45], 'Africa/Bamako': ['ML', 'Bamako', 12.6, -8.0],
  'Africa/Ouagadougou': ['BF', 'Ouagadougou', 12.4, -1.5], 'Africa/Niamey': ['NE', 'Niamey', 13.5, 2.1], 'Africa/Ndjamena': ['TD', 'N’Djamena', 12.1, 15.0],
  'Africa/Conakry': ['GN', 'Conakry', 9.6, -13.6], 'Africa/Freetown': ['SL', 'Freetown', 8.5, -13.2], 'Africa/Monrovia': ['LR', 'Monrovia', 6.3, -10.8],
  'Africa/Lome': ['TG', 'Lomé', 6.1, 1.2], 'Africa/Porto-Novo': ['BJ', 'Porto-Novo', 6.5, 2.6], 'Africa/Douala': ['CM', 'Douala', 4.05, 9.7],
  'Africa/Libreville': ['GA', 'Libreville', 0.4, 9.45], 'Africa/Malabo': ['GQ', 'Malabo', 3.75, 8.8], 'Africa/Brazzaville': ['CG', 'Brazzaville', -4.3, 15.3],
  'Africa/Kinshasa': ['CD', 'Kinshasa', -4.3, 15.3], 'Africa/Lubumbashi': ['CD', 'Lubumbashi', -11.7, 27.5], 'Africa/Bangui': ['CF', 'Bangui', 4.4, 18.6],
  'Africa/Luanda': ['AO', 'Luanda', -8.8, 13.2], 'Africa/Lusaka': ['ZM', 'Lusaka', -15.4, 28.3], 'Africa/Harare': ['ZW', 'Harare', -17.8, 31.05],
  'Africa/Maputo': ['MZ', 'Maputo', -25.97, 32.6], 'Africa/Blantyre': ['MW', 'Blantyre', -15.8, 35.0], 'Africa/Gaborone': ['BW', 'Gaborone', -24.65, 25.9],
  'Africa/Windhoek': ['NA', 'Windhoek', -22.6, 17.1], 'Africa/Johannesburg': ['ZA', 'Johannesburg', -26.2, 28.05], 'Africa/Maseru': ['LS', 'Maseru', -29.3, 27.5],
  'Africa/Mbabane': ['SZ', 'Mbabane', -26.3, 31.1], 'Indian/Antananarivo': ['MG', 'Antananarivo', -18.9, 47.5], 'Indian/Mauritius': ['MU', 'Port Louis', -20.2, 57.5],
  'Indian/Mahe': ['SC', 'Victoria', -4.6, 55.45], 'Africa/Nouakchott': ['MR', 'Nouakchott', 18.1, -15.95], 'Africa/Banjul': ['GM', 'Banjul', 13.45, -16.6],
  'Africa/Bissau': ['GW', 'Bissau', 11.85, -15.6], 'Atlantic/Cape_Verde': ['CV', 'Praia', 14.9, -23.5],
};

// Language without a region → the country where most of its web users live (fallback only).
const LANG_COUNTRY = { en: 'US', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL', sv: 'SE', nb: 'NO', no: 'NO', da: 'DK', fi: 'FI', pl: 'PL', cs: 'CZ',
  sk: 'SK', hu: 'HU', ro: 'RO', bg: 'BG', el: 'GR', tr: 'TR', ru: 'RU', uk: 'UA', ja: 'JP', ko: 'KR', zh: 'CN', th: 'TH', vi: 'VN', id: 'ID', ms: 'MY',
  hi: 'IN', bn: 'BD', ar: 'SA', he: 'IL', fa: 'IR', ur: 'PK', sw: 'KE', et: 'EE', lv: 'LV', lt: 'LT', sl: 'SI', hr: 'HR', sr: 'RS', is: 'IS', ga: 'IE', ca: 'ES' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isCountry = c => typeof c === 'string' && Object.prototype.hasOwnProperty.call(COUNTRY_GEO, c);
export const countryLabel = c => isCountry(c) ? COUNTRY_GEO[c][0] : (c || 'Unknown');

/** Country centroid as a geo record, or null for an unknown code. */
export function countryGeo(code) {
  const c = String(code || '').trim().toUpperCase();
  return isCountry(c) ? { country: c, lat: COUNTRY_GEO[c][1], lon: COUNTRY_GEO[c][2] } : null;
}

/** Validate an untrusted geo object → { country, city?, lat, lon } or null. Unknown country codes are rejected. */
export function normalizeGeo(g) {
  if (!g || typeof g !== 'object') return null;
  const country = String(g.country || '').trim().toUpperCase();
  if (!isCountry(country)) return null;
  let lat = +g.lat, lon = +g.lon;
  if (!isFinite(lat) || !isFinite(lon)) { lat = COUNTRY_GEO[country][1]; lon = COUNTRY_GEO[country][2]; }
  const out = { country, lat: Math.round(clamp(lat, -90, 90) * 100) / 100, lon: Math.round(clamp(lon, -180, 180) * 100) / 100 };
  const city = typeof g.city === 'string' ? g.city.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) : '';
  if (city) out.city = city;
  return out;
}

/**
 * Approximate location from what any browser exposes without asking: Intl time zone + navigator.language.
 * → { country, city?, lat, lon } or null. The time zone wins (it carries a city); the language region is the fallback.
 */
export function geoFromBrowser(timeZone, language) {
  const tz = typeof timeZone === 'string' ? timeZone.trim().slice(0, 64) : '';
  const t = Object.prototype.hasOwnProperty.call(TZ_GEO, tz) ? TZ_GEO[tz] : null;
  if (t) return normalizeGeo({ country: t[0], city: t[1], lat: t[2], lon: t[3] });
  const m = /^([a-z]{2,3})(?:[-_](?:[A-Za-z]{4}[-_])?([A-Za-z]{2}))?/i.exec(typeof language === 'string' ? language.trim() : '');
  if (!m) return null;
  const region = (m[2] || '').toUpperCase(), lang = m[1].toLowerCase();
  return countryGeo(isCountry(region) ? region : LANG_COUNTRY[lang] || '');
}

/** Flag emoji for an ISO alpha-2 code ('' when invalid). */
export function flagEmoji(code) {
  const c = String(code || '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map(ch => 0x1f1a5 + ch.charCodeAt(0))) : '';
}

/** Find a country mentioned at the end of a free-text address ("…, Lisbon, Portugal" / "… PT"). → code or ''. */
export function countryFromAddress(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const parts = s.split(/[\n,]/).map(x => x.trim()).filter(Boolean).reverse();
  for (const p of parts.slice(0, 3)) {
    const up = p.toUpperCase();
    if (/^[A-Z]{2}$/.test(up) && isCountry(up)) return up;
    const alias = { USA: 'US', 'U.S.A.': 'US', 'UNITED STATES OF AMERICA': 'US', UK: 'GB', 'GREAT BRITAIN': 'GB', ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB', TURKEY: 'TR', 'CZECH REPUBLIC': 'CZ', HOLLAND: 'NL' }[up];
    if (alias) return alias;
    for (const [code, [name]] of Object.entries(COUNTRY_GEO)) if (name.toUpperCase() === up) return code;
  }
  return '';
}
