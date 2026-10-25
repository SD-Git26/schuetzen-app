'use strict';

// Disziplinen nach DSB-Sportordnung (Anhang 0.21) und RSB-Liste B (Landesdisziplinen Rheinland).
// Bogen, Blasrohr und Lichtschießen sind weggelassen.
// Aufbau: [Kennzahl, Name, Distanz, Kaliber/Gerät, Schussprogramm, Quelle (ohne Angabe = DSB)]
// Schussprogramm = Serien × Schuss pro Serie der Wettkampfklasse Herren I ohne Probeschüsse;
// „T“ = Trefferwertung (1 pro Schuss) statt Ringen.

const DISCIPLINE_GROUPS = {
  '1': 'Gewehr',
  '2': 'Pistole & Revolver',
  '3': 'Flinte',
  '4': 'Laufende Scheibe',
  '5': 'Armbrust',
  '7': 'Vorderlader',
  '8': 'Sommerbiathlon & Target Sprint',
};

const DISCIPLINE_LIST = [
  ['1.10', 'Luftgewehr', '10 m', '4,5 mm', '6×10'],
  ['1.11', 'Luftgewehr Auflage', '10 m', '4,5 mm', '3×10'],
  ['1.20', 'Luftgewehr 3-Stellung', '10 m', '4,5 mm', '6×10'],
  ['1.30', 'Zimmerstutzen', '15/10 m', '4,65 mm', '3×10'],
  ['1.31', 'Zimmerstutzen Auflage', '15 m', '4,65 mm', '3×10'],
  ['1.35', 'KK-Gewehr', '100 m', '.22 lfB', '3×10'],
  ['1.36', 'KK-Gewehr Auflage', '100 m', '.22 lfB', '3×10'],
  ['1.37', 'GK Feuerstutzen', '50 m', '8,15×46R', '3×10'],
  ['1.38', 'GK Feuerstutzen', '100 m', '8,15×46R', '3×10'],
  ['1.40', 'KK-Sportgewehr 3×20', '50 m', '.22 lfB', '6×10'],
  ['1.41', 'KK-Sportgewehr Auflage', '50 m', '.22 lfB', '3×10'],
  ['1.42', 'KK-Gewehr stehend (Diopter oder ZF)', '50 m', '.22 lfB', '3×10'],
  ['1.43', 'KK-Gewehr Zielfernrohr aufgelegt', '50 m', '.22 lfB', '3×10'],
  ['1.44', 'KK-Gewehr Zielfernrohr aufgelegt', '100 m', '.22 lfB', '3×10'],
  ['1.45', 'KK-Sportgewehr Mehrlader', '50 m', '.22 lfB', '3×10'],
  ['1.45.01', 'KK Zielfernrohr Auflage', '50 m', '.22 lfB', '3×10', 'RSB'],
  ['1.50', 'GK-Standardgewehr', '300 m', '≤ 8 mm', '6×10'],
  ['1.51', 'GK-Standardgewehr', '50 m', '≤ 8 mm', '6×10'],
  ['1.51.01', 'GK Zielfernrohr Auflage', '100 m', '< 8 mm (.323)', '3×10', 'RSB'],
  ['1.52', 'GK-Standardgewehr', '100 m', '≤ 8 mm', '6×10'],
  ['1.53', 'GK-Standardgewehr Mehrlader', '300 m', '≤ 8 mm', '6×10'],
  ['1.54', 'GK-Standardgewehr Mehrlader', '50 m', '≤ 8 mm', '6×10'],
  ['1.55', 'GK-Standardgewehr Mehrlader', '100 m', '≤ 8 mm', '6×10'],
  ['1.56', 'Unterhebelrepetierer', '50 m', '.22 lfB', '8×5'],
  ['1.56', 'Unterhebelrepetierer (RSB-Variante)', '50 m', '.22 lfB', '8×5', 'RSB'],
  ['1.57', 'Unterhebelrepetierer', '50 m', '≤ .45', '8×5'],
  ['1.58 O', 'Ordonnanzgewehr, offene Visierung', '100 m', '≤ 8 mm', '4×10'],
  ['1.58 G', 'Ordonnanzgewehr, geschlossene Visierung', '100 m', '≤ 8 mm', '4×10'],
  ['1.58.01', 'Ordonnanzgewehr liegend/stehend', '50 m', '.22 lfB', '2×10', 'RSB'],
  ['1.58.02', 'Ordonnanzgewehr bis Baujahr 1945, liegend', '100 m', '6,5–8 mm', '2×10', 'RSB'],
  ['1.59', 'GK-Sportgewehr', '300 m', '≤ 8 mm', '6×10'],
  ['1.60', 'KK-Freigewehr 120 Schuss', '50 m', '.22 lfB', '12×10'],
  ['1.70', 'GK-Freigewehr 120 Schuss', '300 m', '≤ 8 mm', '12×10'],
  ['1.71', 'GK-Freigewehr 120 Schuss', '50 m', '≤ 8 mm', '12×10'],
  ['1.72', 'GK-Freigewehr 120 Schuss', '100 m', '≤ 8 mm', '12×10'],
  ['1.80', 'KK-Liegendkampf', '50 m', '.22 lfB', '6×10'],
  ['1.85', 'KK-Liegendkampf Mehrlader', '50 m', '.22 lfB', '6×10'],
  ['1.90', 'GK-Liegendkampf', '300 m', '≤ 8 mm', '6×10'],
  ['1.91', 'GK-Liegendkampf', '50 m', '≤ 8 mm', '6×10'],
  ['1.92', 'GK-Liegendkampf', '100 m', '≤ 8 mm', '6×10'],
  ['1.95', 'GK-Liegendkampf Mehrlader', '300 m', '≤ 8 mm', '6×10'],
  ['1.96', 'GK-Liegendkampf Mehrlader', '50 m', '≤ 8 mm', '6×10'],
  ['1.97', 'GK-Liegendkampf Mehrlader', '100 m', '≤ 8 mm', '6×10'],
  ['1.99', 'Unterhebelrepetierer Zentralfeuer (vor 1900)', '50 m', 'Zentralfeuer', '8×5', 'RSB'],
  ['2.10', 'Luftpistole', '10 m', '4,5 mm', '6×10'],
  ['2.11', 'Luftpistole Auflage', '10 m', '4,5 mm', '3×10'],
  ['2.16', 'Mehrschüssige Luftpistole', '10 m', '4,5 mm', '12×5'],
  ['2.17', 'Luftpistole Mehrkampf', '10 m', '4,5 mm', '8×5'],
  ['2.18', 'Luftpistole Standard', '10 m', '4,5 mm', '8×5'],
  ['2.20', 'Pistole (Freie Pistole)', '50 m', '.22 lfB', '6×10'],
  ['2.21', 'Pistole Auflage', '50 m', '.22 lfB', '3×10'],
  ['2.30', 'Schnellfeuerpistole', '25 m', '.22 lfB', '12×5'],
  ['2.31', 'Schnellfeuerpistole Nachwuchs', '25 m', '.22 lfB', '12×5'],
  ['2.32', 'Schnellfeuerpistole .22 kurz', '25 m', '.22 kurz', '12×5', 'RSB'],
  ['2.40', 'Pistole (Sportpistole)', '25 m', '.22 lfB', '12×5'],
  ['2.41', 'Pistole Nachwuchs', '25 m', '.22 lfB', '12×5'],
  ['2.42', 'Sportpistole Auflage Präzision', '25 m', '.22 lfB', '6×5'],
  ['2.43', 'Sportpistole/-revolver Präzision, beidhändig', '25 m', '.22 lfB', '6×5', 'RSB'],
  ['2.45', 'Zentralfeuerpistole', '25 m', '7,62–9,65 mm', '12×5'],
  ['2.51', 'Großkaliberpistole .30', '25 m', '.30', '8×5'],
  ['2.52', 'Großkaliberpistole .32', '25 m', '7,65 mm', '8×5'],
  ['2.53', 'Pistole 9 mm', '25 m', '9×19', '8×5'],
  ['2.54', 'Großkaliberpistole .38', '25 m', '.38', '8×5'],
  ['2.55', 'Revolver .357 Magnum', '25 m', '.357 Mag.', '8×5'],
  ['2.56', 'Großkaliberpistole 10 mm', '25 m', '10 mm', '8×5'],
  ['2.57', 'Großkaliberrevolver .41', '25 m', '.41', '8×5'],
  ['2.58', 'Revolver .44 Magnum', '25 m', '.44 Mag.', '8×5'],
  ['2.59', 'Pistole .45', '25 m', '.45', '8×5'],
  ['2.60', 'Standardpistole', '25 m', '.22 lfB', '12×5'],
  ['3.10', 'Trap', '', '12/70', '3×25 T'],
  ['3.15', 'Doppeltrap', '', '12/70', '3×50 T'],
  ['3.20', 'Skeet', '', '12/70', '3×25 T'],
  ['3.30', 'Compak-Sporting', '', '12/70', '3×25 T'],
  ['3.35', 'Parcours-Sporting', '', '12/70', '3×25 T'],
  ['3.40', 'Universal-Trap', '', '12/70', '3×25 T'],
  ['4.10', 'Laufende Scheibe', '10 m', '4,5 mm', '6×10'],
  ['4.15', 'Laufende Scheibe MIX', '10 m', '4,5 mm', '4×10'],
  ['4.20', 'Laufende Scheibe', '50 m', '.22 lfB', '6×10'],
  ['4.25', 'Laufende Scheibe MIX', '50 m', '.22 lfB', '4×10'],
  ['5.10', 'Armbrust', '10 m', 'Bolzen 4,5 mm', '4×10'],
  ['5.11', 'Armbrust Auflage', '10 m', 'Bolzen 4,5 mm', '3×10'],
  ['5.20', 'Armbrust international', '30 m', 'Bolzen 6,0 mm', '6×10'],
  ['5.31', 'Armbrust national Scheibe', '30 m', 'Bolzen 6,0 mm', '2×10'],
  ['5.32', 'Armbrust national Stern', 'Vogelbaum', 'Bolzenkopf', '1×15'],
  ['5.33', 'Armbrust national kombiniert', '30 m / Vogelbaum', 'Bolzen', '1×15'],
  ['5.34', 'Armbrust national Adler', '30 m / Vogelbaum', 'Bolzenkopf', '1×15'],
  ['5.41', 'Feldarmbrust IAU 600', '18 m', 'Pfeile', '20×3'],
  ['5.42', 'Feldarmbrust IAU 600', '25 m', 'Pfeile', '20×3'],
  ['5.43', 'Feldarmbrust IAU 900', '65/50/35 m', 'Pfeile', '3×30'],
  ['7.10', 'Perkussionsgewehr', '50 m', 'beliebig', '1×15'],
  ['7.11', 'Perkussionsgewehr Auflage', '50 m', 'beliebig', '1×15'],
  ['7.15', 'Perkussionsfreigewehr', '100 m', 'beliebig', '1×15'],
  ['7.16', 'Perkussionsfreigewehr', '300 m', 'beliebig', '1×15'],
  ['7.20', 'Perkussionsdienstgewehr, liegend', '100 m', '≥ 13,5 mm', '1×15'],
  ['7.21', 'Perkussionsdienstgewehr, stehend', '50 m', '≥ 13,5 mm', '1×15'],
  ['7.30', 'Steinschlossgewehr', '50 m', 'beliebig, Rundkugel', '1×15'],
  ['7.31', 'Steinschlossgewehr, liegend', '100 m', 'beliebig, Rundkugel', '1×15'],
  ['7.32', 'Luntenschlossgewehr', '50 m', 'beliebig', '1×15'],
  ['7.35', 'Muskete', '50 m', '≥ 16,5 mm', '1×15'],
  ['7.40', 'Perkussionsrevolver', '25 m', 'beliebig', '1×15'],
  ['7.50', 'Perkussionspistole', '25 m', 'beliebig, Rundkugel', '1×15'],
  ['7.51', 'Perkussionspistole Auflage', '25 m', 'beliebig, Rundkugel', '1×15'],
  ['7.60', 'Steinschlosspistole', '25 m', 'beliebig, Rundkugel', '1×15'],
  ['7.61', 'Luntenschlosspistole', '25 m', '≥ 8,6 mm', '1×15'],
  ['7.71', 'Perkussionsflinte', '', 'Schrot', '2×25 T'],
  ['7.72', 'Steinschlossflinte', '', 'Schrot', '2×25 T'],
  ['8.10', 'Sommerbiathlon LG Sprint', '10 m', '4,5 mm', '2×5 T'],
  ['8.11', 'Sommerbiathlon LG Massenstart', '10 m', '4,5 mm', '4×5 T'],
  ['8.12', 'Sommerbiathlon LG Einzel', '10 m', '4,5 mm', '4×5 T'],
  ['8.13', 'Sommerbiathlon LG Staffel/Mannschaft', '10 m', '4,5 mm', '2×5 T'],
  ['8.14', 'Sommerbiathlon LG Single-Mixed-Staffel', '10 m', '4,5 mm', '2×5 T'],
  ['8.20', 'Sommerbiathlon KK Sprint', '50 m', '.22 lfB', '2×5 T'],
  ['8.21', 'Sommerbiathlon KK Massenstart', '50 m', '.22 lfB', '4×5 T'],
  ['8.22', 'Sommerbiathlon KK Einzel', '50 m', '.22 lfB', '4×5 T'],
  ['8.23', 'Sommerbiathlon KK Staffel/Mannschaft', '50 m', '.22 lfB', '2×5 T'],
  ['8.24', 'Sommerbiathlon KK Single-Mixed-Staffel', '50 m', '.22 lfB', '2×5 T'],
  ['8.30', 'Target Sprint Einzel', '10 m', '4,5 mm', '2×5 T'],
  ['8.31', 'Target Sprint Team m/w', '10 m', '4,5 mm', '2×5 T'],
  ['8.32', 'Target Sprint Single Mixed', '10 m', '4,5 mm', '2×5 T'],
  ['8.33', 'Target Sprint Mixed Team', '10 m', '4,5 mm', '2×5 T'],
];

// Disziplinen des BDS (Bund Deutscher Sportschützen) nach Kennziffernliste, Stand 14.07.2026.
// Aufbau: [Disziplin, Distanz, Schussprogramm, [[Kennziffer, Waffenklasse], …]]
// Schussprogramm wie oben, nach dem Programm der Deutschen Meisterschaft (BDS-Sporthandbuch).
// Wo Ablauf oder Schusszahl die Ausschreibung festlegt (z. B. IPSC, Western), ist es nur ein Vorschlag.
// Wertung in ganzen Ringen, bei Fallscheiben, Wurfscheiben, Silhouette u. Ä. in Treffern.
const BDS_LIST = [
  ['25m Präzision', '25 m', '2×10', [
    ['1001', 'Pistole bis 9 mm'], ['1002', 'Pistole über 9 mm'], ['1003', 'Pistole Magnum bis .357'], ['1004', 'Pistole Magnum über .357'],
    ['1006', 'Revolver bis .38'], ['1007', 'Revolver über .38'], ['1008', 'Revolver Magnum bis .357'], ['1009', 'Revolver Magnum über .357'],
    ['1010', 'Freie Klasse Pistole/Revolver .22, offene Visierung'], ['1011', 'Freie Klasse Pistole/Revolver mind. .30'],
    ['1012', 'Freie Klasse Pistole/Revolver .22 mit Optik'], ['1014', 'Dienst-Sportpistole/-revolver'], ['1015', 'Freie Klasse Pistole/Revolver .32 S&W long']]],
  ['25m Kombi', '25 m', '8×5', [
    ['1101', 'Pistole bis 9 mm'], ['1102', 'Pistole über 9 mm'], ['1103', 'Pistole Magnum bis .357'], ['1104', 'Pistole Magnum über .357'],
    ['1106', 'Revolver bis .38'], ['1107', 'Revolver über .38'], ['1108', 'Revolver Magnum bis .357'], ['1109', 'Revolver Magnum über .357'],
    ['1110', 'Freie Klasse Pistole/Revolver .22, offene Visierung'], ['1111', 'Freie Klasse Pistole/Revolver mind. .30'],
    ['1112', 'Freie Klasse Pistole/Revolver .22 mit Optik'], ['1114', 'Dienst-Sportpistole/-revolver'], ['1115', 'Freie Klasse Pistole/Revolver .32 S&W long']]],
  ['Mehrdistanz Kurzwaffe', '5–20 m', '8×5', [
    ['1201', 'Pistole bis 9 mm'], ['1202', 'Pistole über 9 mm'], ['1205', 'Revolver unter 4"'], ['1206', 'Revolver bis .38'],
    ['1207', 'Revolver über .38'], ['1208', 'Revolver Magnum bis .357'], ['1209', 'Revolver Magnum über .357'],
    ['1210', 'Freie Klasse Pistole/Revolver .22, offene Visierung'], ['1211', 'Freie Klasse Pistole/Revolver mind. .30'],
    ['1212', 'Freie Klasse Pistole/Revolver .22 mit Optik'], ['1214', 'Dienst-Sportpistole/-revolver'], ['1224', 'Dienst-Sportpistole/-revolver 2']]],
  ['25m Fallscheibe GK', '25 m', '6×5 T', [
    ['1301', 'Pistole'], ['1306', 'Revolver'], ['1316', 'Freie Klasse Pistole mind. .30'], ['1317', 'Freie Klasse Revolver mind. .30'],
    ['1324', 'Dienst-Sportpistole/-revolver 2']]],
  ['25m Speed', '25 m', '6×5', [
    ['1401', 'Pistole Standardkaliber'], ['1403', 'Pistole Magnum'], ['1406', 'Revolver Standardkaliber'], ['1408', 'Revolver Magnum'],
    ['1410', 'Freie Klasse Pistole .22, offene Visierung'], ['1413', 'Single Action Revolver'], ['1416', 'Freie Klasse Pistole mind. .30'],
    ['1417', 'Freie Klasse Revolver mind. .30'], ['1418', 'Freie Klasse Revolver .22, offene Visierung'],
    ['1419', 'Freie Klasse Pistole .22 mit Optik'], ['1420', 'Freie Klasse Revolver .22 mit Optik']]],
  ['25m Fallscheibe KK', '25 m', '6×5 T', [
    ['1510', 'Freie Klasse Pistole .22, offene Visierung'], ['1518', 'Freie Klasse Revolver .22, offene Visierung'],
    ['1519', 'Freie Klasse Pistole .22 mit Optik'], ['1520', 'Freie Klasse Revolver .22 mit Optik']]],
  ['25m Präzision Büchse', '25 m', '2×10', [
    ['2001', 'Selbstlader Kurzwaffenpatrone, offene Visierung'], ['2002', 'Selbstlader KK, optische Visierung'],
    ['2003', 'Repetierbüchse Kurzwaffenpatrone, offene Visierung'], ['2004', 'Repetierbüchse KK, offene Visierung'],
    ['2010', 'Selbstlader Kurzwaffenpatrone, optische Visierung'], ['2011', 'Repetierbüchse Kurzwaffenpatrone, optische Visierung'],
    ['2012', 'Selbstlader KK, offene Visierung'], ['2014', 'Repetierbüchse KK, optische Visierung']]],
  ['50m Präzision', '50 m', '3×10', [
    ['2101', 'Selbstlader Kurzwaffenpatrone, offene Visierung'], ['2102', 'Selbstlader KK, optische Visierung'],
    ['2103', 'Repetierbüchse Kurzwaffenpatrone, offene Visierung'], ['2104', 'Repetierbüchse KK, offene Visierung'],
    ['2105', 'Dienstsportgewehr KK, offene Kimme'], ['2106', 'Dienstsportgewehr KK, geschlossene Kimme + Diopter'],
    ['2107', 'Matchsportgewehr KK'], ['2108', 'Präzisionssportgewehr KK'], ['2109', 'Freie Klasse, .22 WinMag oder .17 HMR'],
    ['2110', 'Selbstlader Kurzwaffenpatrone, optische Visierung'], ['2111', 'Repetierbüchse Kurzwaffenpatrone, optische Visierung'],
    ['2112', 'Selbstlader KK, offene Visierung'], ['2113', 'Zielfernrohrgewehr KK'], ['2114', 'Repetierbüchse KK, optische Visierung'],
    ['2115', 'Zielfernrohrgewehr Kurzwaffenpatrone'], ['2116', 'Präzisionsgewehr KK Light Varmint'], ['2117', 'Präzisionsgewehr KK Heavy Varmint']]],
  ['50m Intervall', '50 m', '6×5', [
    ['2201', 'Selbstlader Kurzwaffenpatrone, offene Visierung'], ['2210', 'Selbstlader Kurzwaffenpatrone, optische Visierung']]],
  ['50m Zeitserie', '50 m', '6×5', [
    ['2301', 'Selbstlader Kurzwaffenpatrone, offene Visierung'], ['2302', 'Selbstlader KK, optische Visierung'],
    ['2310', 'Selbstlader Kurzwaffenpatrone, optische Visierung'], ['2312', 'Selbstlader KK, offene Visierung']]],
  ['50m Fertigkeit', '50 m', '3×10', [
    ['2401', 'Selbstlader Kurzwaffenpatrone, offene Visierung'], ['2402', 'Selbstlader KK, optische Visierung'],
    ['2410', 'Selbstlader Kurzwaffenpatrone, optische Visierung'], ['2412', 'Selbstlader KK, offene Visierung']]],
  ['25m Fallscheibe Büchse GK', '25 m', '6×5 T', [
    ['2501', 'Selbstlader Kurzwaffenpatrone, offene Visierung'], ['2503', 'Repetierbüchse Kurzwaffenpatrone, offene Visierung'],
    ['2510', 'Selbstlader Kurzwaffenpatrone, optische Visierung'], ['2511', 'Repetierbüchse Kurzwaffenpatrone, optische Visierung']]],
  ['50m Symbolscheibe', '50 m', '1×38', [
    ['2602', 'Selbstlader KK, optische Visierung'], ['2610', 'Selbstlader Kurzwaffenpatrone, optische Visierung']]],
  ['25m Fallscheibe Büchse KK', '25 m', '6×5 T', [
    ['2702', 'Selbstlader KK, optische Visierung'], ['2704', 'Repetierbüchse KK, offene Visierung'],
    ['2712', 'Selbstlader KK, offene Visierung'], ['2714', 'Repetierbüchse KK, optische Visierung']]],
  ['25m Kombi Büchse', '25 m', '8×5', [
    ['2801', 'Selbstlader Kurzwaffenpatrone, offene Visierung'], ['2802', 'Selbstlader KK, optische Visierung'],
    ['2803', 'Repetierbüchse Kurzwaffenpatrone, offene Visierung'], ['2804', 'Repetierbüchse KK, offene Visierung'],
    ['2810', 'Selbstlader Kurzwaffenpatrone, optische Visierung'], ['2811', 'Repetierbüchse Kurzwaffenpatrone, optische Visierung'],
    ['2812', 'Selbstlader KK, offene Visierung'], ['2814', 'Repetierbüchse KK, optische Visierung']]],
  ['100m Präzision', '100 m', '3×10', [
    ['3101', 'Matchsportgewehr'], ['3102', 'Präzisionssportgewehr'], ['3103', 'Jagdgewehr bis 6,4 mm'], ['3104', 'Jagdgewehr über 6,4 mm'],
    ['3105', 'Unterhebelrepetierer'], ['3106', 'Dienstsportgewehr, offene Kimme'], ['3107', 'Dienstsportgewehr, geschlossene Kimme und Diopter'],
    ['3108', 'Präzisionsgewehr bis 7 mm'], ['3109', 'Dienstsportgewehr Selbstlader, offene Kimme'],
    ['3110', 'Dienstsportgewehr Selbstlader, geschlossene Kimme und Diopter'], ['3111', 'Dienstsportgewehr Zielfernrohr'],
    ['3112', 'Selbstlader, offene Visierung, Hülse unter 47 mm'], ['3113', 'Selbstlader, offene Visierung, Hülse ab 47 mm'],
    ['3114', 'Selbstlader, optische Visierung, Hülse unter 47 mm'], ['3115', 'Selbstlader, optische Visierung, Hülse ab 47 mm'],
    ['3117', 'Zielfernrohrgewehr über 7 mm'], ['3118', 'Zielfernrohrgewehr bis 7 mm'], ['3119', 'Präzisionsgewehr über 7 mm'],
    ['3123', 'Zielfernrohrgewehr Selbstlader'], ['3124', 'Zielfernrohrgewehr KK'], ['3125', 'Büchse KK, offene/geschlossene Visierung']]],
  ['100m Intervall', '100 m', '6×5', [
    ['3212', 'Selbstlader, offene Visierung, Hülse unter 47 mm'], ['3213', 'Selbstlader, offene Visierung, Hülse ab 47 mm'],
    ['3226', 'Selbstlader, optische Visierung']]],
  ['100m Zeitserie', '100 m', '6×5', [
    ['3311', 'Dienstsportgewehr Selbstlader'], ['3312', 'Selbstlader, offene Visierung, Hülse unter 47 mm'],
    ['3313', 'Selbstlader, offene Visierung, Hülse ab 47 mm'], ['3314', 'Selbstlader, optische Visierung, Hülse unter 47 mm'],
    ['3315', 'Selbstlader, optische Visierung, Hülse ab 47 mm']]],
  ['100m Fertigkeit', '100 m', '3×10', [
    ['3412', 'Selbstlader, offene Visierung, Hülse unter 47 mm'], ['3413', 'Selbstlader, offene Visierung, Hülse ab 47 mm'],
    ['3416', 'Zielfernrohrgewehr Selbstlader, Hülse unter 47 mm'], ['3420', 'Zielfernrohrgewehr Selbstlader, Hülse ab 47 mm']]],
  ['Mehrdistanz Büchse LW-Kaliber', '30–50 m', '6×5', [
    ['3812', 'Selbstlader, offene Visierung, Hülse unter 47 mm'], ['3813', 'Selbstlader, offene Visierung, Hülse ab 47 mm'],
    ['3814', 'Selbstlader, optische Visierung, Hülse unter 47 mm'], ['3815', 'Selbstlader, optische Visierung, Hülse ab 47 mm']]],
  ['300m Präzision', '300 m', '3×10', [
    ['4101', 'Matchsportgewehr'], ['4102', 'Dienstsportgewehr, offene Kimme'], ['4103', 'Dienstsportgewehr, geschlossene Kimme und Diopter'],
    ['4105', 'Hochleistungsgewehr'], ['4106', 'Zielfernrohrgewehr Selbstlader'], ['4107', 'Zielfernrohrgewehr über 7 mm'],
    ['4108', 'Präzisionsgewehr bis 7 mm'], ['4109', 'Präzisionsgewehr über 7 mm'], ['4110', 'Zielfernrohrgewehr bis 7 mm']]],
  ['25m Speed Flinte', '25 m', '4×5', [
    ['4301', 'Selbstladeflinte, offene Visierung'], ['4302', 'Selbstladeflinte, optische Visierung'],
    ['4303', 'Repetierflinte, offene Visierung'], ['4304', 'Repetierflinte, optische Visierung']]],
  ['15m Fallscheibe Flinte', '15 m', '4×5 T', [
    ['4401', 'Selbstladeflinte, offene Visierung'], ['4402', 'Selbstladeflinte, optische Visierung'],
    ['4403', 'Repetierflinte, offene Visierung'], ['4404', 'Repetierflinte, optische Visierung'],
    ['4405', 'Doppelflinte mit Ejektor'], ['4406', 'Doppelflinte ohne Ejektor']]],
  ['Mehrdistanz Flinte', '15–25 m', '6×5', [
    ['4501', 'Selbstladeflinte, offene Visierung'], ['4503', 'Repetierflinte, offene Visierung'], ['4505', 'Freie Klasse']]],
  ['25m Speed Büchse', '25 m', '6×5', [
    ['4601', 'Selbstlader Kurzwaffenpatrone, offene Visierung'], ['4602', 'Selbstlader KK, optische Visierung'],
    ['4603', 'Repetierbüchse Kurzwaffenpatrone, offene Visierung'], ['4604', 'Repetierbüchse KK, offene Visierung'],
    ['4610', 'Selbstlader Kurzwaffenpatrone, optische Visierung'], ['4611', 'Repetierbüchse Kurzwaffenpatrone, optische Visierung'],
    ['4612', 'Selbstlader KK, offene Visierung'], ['4614', 'Repetierbüchse KK, optische Visierung']]],
  ['Wurfscheibe', '', '3×15 T', [
    ['4700', 'Trap'], ['4701', 'Skeet'], ['4702', 'Skeet Vorderschaftrepetierflinte'], ['4703', 'Parcours'], ['4704', 'Parcours Vorderschaftrepetierflinte']]],
  ['Mehrdistanz Büchse', '15–25 m', '6×5', [
    ['4801', 'Selbstlader Kurzwaffenpatrone, offene Visierung'], ['4802', 'Selbstlader KK, optische Visierung'],
    ['4803', 'Repetierbüchse Kurzwaffenpatrone, offene Visierung'], ['4810', 'Selbstlader Kurzwaffenpatrone, optische Visierung'],
    ['4812', 'Selbstlader KK, offene Visierung'], ['4814', 'Repetierbüchse KK, optische Visierung']]],
  ['Long Range', '300–1000 m', '3×10', [
    ['4901', 'F/TR (LR1)'], ['4902', 'Open (LR2)'], ['4903', 'Magnum (LR3)'], ['4904', 'Ultra Magnum (LR4)'],
    ['4905', 'Semi Auto (LR5)'], ['4906', 'Semi Auto Open (LR6)'], ['4907', 'Standard (LR7)'], ['4908', 'Standard Open (LR8)']]],
  ['Silhouette', '', '4×10 T', [
    ['5101', 'Big Bore Pistol – Revolver'], ['5102', 'Big Bore Pistol – Production'], ['5103', 'Big Bore Pistol – Standing'],
    ['5104', 'Big Bore Pistol – Unlimited'], ['5201', 'Small Bore Pistol – Revolver'], ['5202', 'Small Bore Pistol – Production'],
    ['5203', 'Small Bore Pistol – Standing'], ['5204', 'Small Bore Pistol – Unlimited'], ['5301', 'Field Pistol – Production'],
    ['5302', 'Field Pistol – Production any sights'], ['5401', 'Big Bore Rifle – Silhouette'], ['5402', 'Big Bore Rifle – Hunting'],
    ['5501', 'Small Bore Rifle – Silhouette'], ['5502', 'Small Bore Rifle – Light']]],
  ['Perkussion Kurzwaffe', '25 m', '3×5', [
    ['6101', 'Standard Perkussionspistole'], ['6111', 'Freie Perkussionspistole'], ['6121', 'Standard Steinschlosspistole, gezogener Lauf'],
    ['6131', 'Standard Steinschlosspistole, glatter Lauf'], ['6141', 'Standard Perkussionsrevolver I'], ['6151', 'Standard Perkussionsrevolver II'],
    ['6161', 'Standard Perkussionsrevolver offener Rahmen'], ['6171', 'Freier Perkussionsrevolver'], ['6181', 'Standard Patronen-Revolver'],
    ['6191', 'Standard Radschlosspistole']]],
  ['Perkussion Langwaffe', '50 m', '3×5', [
    ['6401', 'Standard Perkussionsgewehr I'], ['6411', 'Standard Perkussionsgewehr II'], ['6421', 'Freies Perkussionsgewehr'],
    ['6431', 'Standard Perkussionsdienstgewehr'], ['6441', 'Perkussions-Hinterlader'], ['6451', 'Standard Steinschlossgewehr, gezogener Lauf I'],
    ['6461', 'Standard Steinschlossgewehr, gezogener Lauf II'], ['6471', 'Muskete'], ['6481', 'Standard Einzelladergewehr'],
    ['6491', 'Standard Mehrladergewehr'], ['6501', 'Standard Radschlossgewehr']]],
  ['Field Target', '', '2×20 T', [
    ['7101', 'Pressluftgewehr bis 16,3 J'], ['7102', 'Feder-/Gasdruckkolbengewehr bis 16,3 J']]],
  ['IPSC Kurzwaffe', '', '1×30', [
    ['8101', 'Open'], ['8102', 'Standard Pistole'], ['8104', 'Production'], ['8105', 'Standard Revolver'], ['8108', 'Classic'], ['8109', 'Production Optic']]],
  ['IPSC Kurzwaffe KK', '', '1×30', [
    ['8106', 'Standard KK-Pistole'], ['8107', 'Open KK-Pistole'], ['8110', 'Classic KK-Pistole']]],
  ['IPSC Flinte', '', '1×30', [
    ['8201', 'Open'], ['8202', 'Modifiziert'], ['8203', 'Standard'], ['8204', 'Standard Repetierer']]],
  ['IPSC Büchse', '', '1×30', [
    ['8301', 'Open Selbstlader'], ['8302', 'Standard Selbstlader'], ['8305', 'Mini Rifle Open KK'], ['8306', 'Mini Rifle Standard KK'],
    ['8310', 'Manual Contemporary'], ['8311', 'Manual Bolt']]],
  ['IPSC Pistol Caliber Carbine', '', '1×30', [
    ['8401', 'PCC Optics'], ['8402', 'PCC Iron']]],
  ['Western', '', '1×30', [
    ['9101', '1890er: Revolver, starre Visierung'], ['9102', '1890er: Revolver, verstellbare Visierung'], ['9103', '1890er: Vorderschaftrepetierbüchse'],
    ['9104', '1890er: Unterhebelrepetierbüchse'], ['9105', '1890er: Vorderschaftrepetierflinte'], ['9106', '1890er: Unterhebelrepetierflinte'],
    ['9107', '1890er: Doppelflinte'], ['9201', '1880er: Revolver, starre Visierung'], ['9202', '1880er: Vorderschaftrepetierbüchse'],
    ['9203', '1880er: Unterhebelrepetierbüchse'], ['9204', '1880er: Unterhebelrepetierflinte'], ['9205', '1880er: Hahndoppelflinte'],
    ['9301', '1870er: VL-Revolver, starre Visierung'], ['9302', '1870er: Unterhebelrepetierbüchse'], ['9303', '1870er: Hahndoppelflinte'],
    ['9401', '97-11: Pistole Standard'], ['9402', '97-11: Pistole modifiziert'], ['9403', '97-11: Vorderschaftrepetierbüchse'],
    ['9404', '97-11: Unterhebelrepetierbüchse'], ['9405', '97-11: Vorderschaftrepetierflinte Mod. 1897'],
    ['9406', '1900: Revolver'], ['9407', '1900: Repetierflinte'], ['9408', '1917: Revolver'], ['9409', '1917: Repetierflinte']]],
  ['Western Sidematch Rifle', '100 m', '3×5', [
    ['9501', 'Unterhebelrepetierbüchse'], ['9502', 'Einzellader-Büchse']]],
  ['Steel Challenge', '', '5×5 T', [
    ['10001', 'Open Pistol'], ['10002', 'Open Revolver'], ['10003', 'Standard Pistol'], ['10004', 'Standard Revolver'],
    ['10005', 'Open Rimfire Pistol'], ['10006', 'Standard Rimfire Pistol'], ['10007', 'Open Semi Auto Rifle'],
    ['10009', 'Standard Semi Auto Rifle'], ['10011', 'Open Rimfire Rifle'], ['10012', 'Standard Rimfire Rifle']]],
];

// Wählbare Listen (Optionen → Disziplinen), immer genau eine. Ohne Auswahl gilt die DSB-Liste.
const DISCIPLINE_SETS = [
  { id: 'dsb', name: 'Disziplinen nach DSB', info: 'DSB-Sportordnung und RSB-Liste B' },
  { id: 'bds', name: 'Disziplinen nach BDS', info: 'Kennziffernliste des Bundes Deutscher Sportschützen' },
];

const parseProgram = program => {
  const [, series, shots, hitFlag] = program.match(/^(\d+)×(\d+)( T)?$/);
  return { series: Number(series), shots: Number(shots), hits: !!hitFlag };
};

// Aufbereitete Liste. Die ID bleibt fest (z. B. "dsb-2.11", "bds-1001"), damit Ergebnisse auf allen Geräten
// und im Vereins-Dashboard derselben Disziplin zugeordnet werden.
const DISCIPLINE_CATALOG = DISCIPLINE_LIST.map(([code, title, distance, caliber, program, source = 'DSB']) => {
  const { series, shots, hits } = parseProgram(program);
  return {
    id: source.toLowerCase() + '-' + code.replace(/\s+/g, '-'),
    code,
    title,
    name: `${code} ${title}${source === 'RSB' && !title.includes('RSB') ? ' (RSB)' : ''}`,
    distance,
    caliber,
    source,
    set: 'dsb',
    group: DISCIPLINE_GROUPS[code.split('.')[0]],
    series,
    shots,
    hits,
    // Voreinstellung der Wertung, beim Eintrag änderbar: Zehntel bei Luftdruck, Kleinkaliber-Gewehr und Auflage,
    // Unterhebelrepetierer aber in ganzen Ringen
    decimal: !hits && !title.startsWith('Unterhebelrepetierer') && (title.includes('Auflage') || code.startsWith('2.1')
      || (code.startsWith('1.') && /4,5|4,65|\.22/.test(caliber))),
  };
}).concat(BDS_LIST.flatMap(([discipline, distance, program, classes]) => classes.map(([code, title]) => ({
  id: 'bds-' + code,
  code,
  title,
  name: `${code} ${discipline} – ${title}`,
  distance,
  caliber: '',
  source: 'BDS',
  set: 'bds',
  group: 'BDS · ' + discipline,
  ...parseProgram(program),
  decimal: false,
}))));
