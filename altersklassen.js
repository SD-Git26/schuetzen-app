'use strict';

// Altersklassen (Wettkampfklassen) nach DSB-Sportordnung und RSB, Sportjahr 2027.
// Maßgeblich ist das Alter, das im Sportjahr erreicht wird. Bogen- und Lichtschießen-Klassen sind
// weggelassen, weil diese Disziplinen in der App nicht vorkommen.
// Wird von der App (Auswahl in Optionen und Eintrag) und vom Vereins-Dashboard (Filter) genutzt.
// Reihenfolge = Reihenfolge in den Auswahllisten. Aufbau: [ID, Name, Alter, Jahrgänge 2027]

const AGE_CLASSES = [
  ['schueler', 'Schüler', '12–14', '2013–2015'],
  ['schueler-2', 'Schüler II', '0–11', '2016–2027'],
  ['jugend', 'Jugend', '15–16', '2011–2012'],
  ['junioren-1', 'Junioren I', '19–20', '2007–2008'],
  ['junioren-2', 'Junioren II', '17–18', '2009–2010'],
  ['hd-1', 'Herren/Damen I', '21–40', '1987–2006'],
  ['hd-2', 'Herren/Damen II', '41–50', '1977–1986'],
  ['hd-3', 'Herren/Damen III', '51–60', '1967–1976'],
  ['hd-4', 'Herren/Damen IV', '61–70', '1957–1966'],
  ['hd-5', 'Herren/Damen V', 'ab 71', '1956 und früher'],
  ['senioren-1', 'Senioren I', '51–60', '1967–1976'],
  ['senioren-2', 'Senioren II', '61–65', '1962–1966'],
  ['senioren-3', 'Senioren III', '66–70', '1957–1961'],
  ['senioren-4', 'Senioren IV', '71–75', '1952–1956'],
  ['senioren-5', 'Senioren V', '76–80', '1947–1951'],
  ['senioren-6', 'Senioren VI', 'ab 81', '1946 und früher'],
  ['para', 'Para SH1/AB1, SH2/AB2, SH3', 'ab 15', '2012 und früher'],
].map(([id, name, age, years]) => ({ id, name, age, years }));

// Entfallene Klassen, die schon gespeichert sein können → Ersatz
const AGE_CLASS_REPLACED = { 'rsb-hd-2-auflage': 'hd-2' };

function ageClassById(id) {
  return AGE_CLASSES.find(c => c.id === (AGE_CLASS_REPLACED[id] || id)) || null;
}
