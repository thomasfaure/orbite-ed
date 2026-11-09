/**
 * Tests des calculs sur les notes (`src/shared/metrics.ts`) et de leur
 * normalisation depuis ÉcoleDirecte (`normalizeNotes`, `number`).
 *
 * Rôle : verrouiller les règles de calcul affichées aux familles. Sont couverts :
 * barèmes et coefficients (un zéro compte, une absence ou un coefficient nul
 * non), moyenne générale par matières, sous-matières et coefficients de matière
 * (avec leurs replis), tableau des matières, évolution de la moyenne sur la
 * fenêtre, notes futures, écart à la classe sur les seules évaluations
 * appariées, lecture des matières ÉcoleDirecte, réglages de masquage de l'établissement,
 * regroupement et résolution des matières et sous-matières, reconnaissance des
 * classes du secondaire, couleurs, photos et prochain jour ouvré.
 *
 * Fonctionnement : fonctions pures appelées avec des notes construites à la
 * main et des dates fixes ; aucun mock n'est nécessaire.
 *
 * Points d'attention : la liste de libellés de classe de `isSecondary` reprend
 * des cas réels. Toute modification de l'expression régulière doit préserver
 * l'ensemble de ces exemples.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generalAverage,
  gradeBand,
  isSecondary,
  mean,
  metrics,
  nextSchoolDay,
  periodSubjects,
  photoUrl,
  subjectAverages,
  subjectGroups,
  toTwenty,
  valid,
} from '../src/shared/metrics.ts';
import { normalizeNotes, number } from '../src/server/ecoledirecte.ts';
import type { Gradable, Subject } from '../src/shared/types.ts';

const n = (value: number | null, outOf = 20, coefficient = 1, date = '2026-11-01'): Gradable => ({
  value,
  outOf,
  coefficient,
  date,
  excluded: false,
});

test('barèmes et coefficients, zéro inclus, absences et coef zéro exclus', () => {
  assert.equal(mean([n(8, 10, 2), n(10, 20, 1)]), 14);
  assert.equal(mean([n(0), n(20)]), 10);
  assert.equal(mean([n(null), n(12, 0), n(10, 20, 0)]), null);
  assert.equal(valid({ ...n(20), excluded: true }), false);
});

test('évolution de la moyenne sur la fenêtre et comparaison appariée', () => {
  const result = metrics(
    [{ ...n(16), classAverage: 12 }, { ...n(10, 20, 1, '2026-09-25'), classAverage: null }, n(20)],
    new Date('2026-11-07T12:00:00Z'),
    30,
  );
  // Moyenne aujourd'hui (16 + 10 + 20) / 3, moins la moyenne il y a 30 jours (10).
  assert.equal(result.trend, 46 / 3 - 10);
  assert.equal(result.recentCount, 2);
  assert.equal(result.previousCount, 1);
  assert.equal(result.gap, 4);
  assert.equal(result.pairedCount, 1);
  // Aucune note avant la fenêtre : pas de moyenne de départ, donc pas d'évolution.
  assert.equal(metrics([n(12)], new Date('2026-11-07')).trend, null);
});

test('notes futures hors évolution ; sans note récente, la moyenne ne bouge pas', () => {
  const r = metrics([n(20, 20, 1, '2030-01-01'), n(10, 20, 1, '2026-09-25')], new Date('2026-11-07'));
  assert.equal(r.trend, 0);
  assert.equal(r.recentCount, 0);
});

const subject = (id: string, coefficient: number | null, extra: Partial<Subject> = {}): Subject => ({
  id,
  label: id,
  sub: !id.endsWith(':'),
  coefficient,
  average: null,
  classAverage: null,
  ...extra,
});
const graded = (subjectId: string, value: number, extra: Partial<Gradable> = {}): Gradable => ({
  ...n(value),
  subjectId,
  ...extra,
});

test('moyenne générale : moyennes par matière, sous-matières puis coefficients des matières', () => {
  const subjects = [subject('MATH:', 4), subject('ANG:', 2), subject('ANG:E', 2), subject('ANG:O', 1)];
  const notes = [graded('MATH:', 10), graded('MATH:', 14), graded('ANG:E', 16), graded('ANG:O', 10)];
  // Maths 12 ; Anglais (16 × 2 + 10 × 1) / 3 = 14 ; générale (12 × 4 + 14 × 2) / 6.
  assert.equal(generalAverage(notes, subjects), 76 / 6);
  // Sans coefficients connus, chaque matière compte pour 1 et les sous-matières sont fusionnées.
  assert.equal(generalAverage(notes), (12 + 13) / 2);
});

test('sous-matières : repli sur toutes les notes si un coefficient manque ou si la matière a ses propres notes', () => {
  const notes = [graded('ANG:E', 16), graded('ANG:O', 10)];
  assert.equal(generalAverage(notes, [subject('ANG:E', 2)]), 13);
  assert.equal(generalAverage([...notes, graded('ANG:', 7)], [subject('ANG:E', 2), subject('ANG:O', 1)]), 11);
  // Des sous-matières toutes à coefficient 0 ne comptent pas.
  assert.equal(generalAverage(notes, [subject('ANG:E', 0), subject('ANG:O', 0)]), null);
});

test('coefficient de matière 0 exclu, absent compté pour 1', () => {
  const notes = [graded('MATH:', 10), graded('EPS:', 20), graded('ART:', 16)];
  assert.equal(generalAverage(notes, [subject('MATH:', 3), subject('EPS:', 0)]), (10 * 3 + 16) / 4);
});

test('tableau des matières : libellés, coefficients, moyennes officielle et de classe', () => {
  const subjects = [
    subject('ANG:', 2, { label: 'ANGLAIS LV1', average: 14.5 }),
    subject('ANG:E', 2, { label: 'Écrit' }),
    subject('ANG:O', 1, { label: 'Oral' }),
  ];
  const note = (subjectId: string, value: number, classAverage: number | null) => ({
    ...graded(subjectId, value, { classAverage }),
    subjectId,
    subject: 'ANGLAIS LV1',
    classAverage,
  });
  const rows = subjectAverages(
    [note('ANG:E', 16, 12), note('ANG:O', 10, null), { ...note('MATH:', 9, 11), subject: 'Mathématiques' }],
    subjects,
  );
  assert.deepEqual(
    rows.map((r) => [r.label, r.coefficient, r.average, r.official, r.classAverage, r.count]),
    [
      ['ANGLAIS LV1', 2, 14, 14.5, 12, 2],
      ['Mathématiques', null, 9, null, 11, 1],
    ],
  );
  assert.deepEqual(
    rows[0]?.subjects.map((s) => [s.label, s.coefficient, s.average]),
    [
      ['Écrit', 2, 16],
      ['Oral', 1, 10],
    ],
  );
});

test('matières de la période : annuelle pour toutes les périodes, sinon union sans moyennes officielles', () => {
  const period = (id: string, annual: boolean, subjects: Subject[]) => ({
    id,
    annual,
    average: null,
    classAverage: null,
    subjects,
  });
  const t1 = period('T1', false, [subject('MATH:', 3, { average: 12 })]);
  const year = period('A', true, [subject('MATH:', 4, { average: 13 })]);
  assert.equal(periodSubjects([t1, year], 'all')[0]?.coefficient, 4);
  assert.equal(periodSubjects([t1, year], 'T1')[0]?.average, 12);
  const union = periodSubjects([t1], 'all');
  assert.equal(union[0]?.coefficient, 3);
  assert.equal(union[0]?.average, null);
});

test('matières ÉcoleDirecte : coefficients, sous-matières, regroupements exclus et masquage', () => {
  const raw = {
    periodes: [
      {
        codePeriode: 'T1',
        ensembleMatieres: {
          disciplines: [
            { codeMatiere: 'SCI', discipline: 'Pôle sciences', groupeMatiere: true },
            { codeMatiere: 'PHILO', codeSousMatiere: '', discipline: 'PHILOSOPHIE', coef: 8, moyenne: '13,5' },
            { codeMatiere: 'ANG', codeSousMatiere: 'O', discipline: 'Oral', sousMatiere: true, coef: '1' },
          ],
        },
      },
    ],
  };
  assert.deepEqual(normalizeNotes(raw).periods[0]?.subjects, [
    { id: 'PHILO:', label: 'PHILOSOPHIE', sub: false, coefficient: 8, average: 13.5, classAverage: null },
    { id: 'ANG:O', label: 'Oral', sub: true, coefficient: 1, average: null, classAverage: null },
  ]);
  const hidden = normalizeNotes({ ...raw, parametrage: { affichageMoyenne: false } });
  assert.equal(hidden.periods[0]?.subjects?.[0]?.average, null);
});

test('valeurs françaises et absences non converties en zéro', () => {
  assert.equal(number('12,50'), 12.5);
  assert.equal(number('ABS'), null);
  assert.equal(number(''), null);
  assert.equal(number('12foo'), null);
  assert.equal(number('0'), 0);
  const r = normalizeNotes({
    notes: [
      { id: 1, valeur: 'ABS', noteSur: '20', coef: '0', libelleMatiere: 'Maths' },
      { id: 2, valeur: '8', noteSur: '10', coef: '2', nonSignificatif: true },
    ],
  });
  assert.equal(r.notes[0]?.value, null);
  assert.equal(r.notes[0]?.coefficient, 0);
  assert.equal(r.notes[1]?.excluded, true);
});

test('paramètres de masquage et absence de données', () => {
  const r = normalizeNotes({
    parametrage: { affichageNote: false, affichageMoyenne: false, moyenneClasse: false },
    notes: [{ valeur: '20' }],
    periodes: [{ codePeriode: 'A1', ensembleMatieres: { moyenneGenerale: '18', moyenneClasse: '12' } }],
  });
  assert.equal(r.notes.length, 0);
  assert.equal(r.periods[0]?.average, null);
  assert.equal(r.periods[0]?.classAverage, null);
  assert.deepEqual(normalizeNotes().notes, []);
  assert.equal(metrics([]).average, null);
});

test('regroupement par code matière et sous-matière', () => {
  assert.equal(
    subjectGroups([
      { subjectId: 'A', subject: 'Maths' },
      { subjectId: 'A', subject: 'Mathématiques' },
      { subjectId: 'B', subject: 'Maths' },
    ]).length,
    2,
  );
});

test('collège et lycée uniquement, classes réelles et variantes usuelles', () => {
  for (const label of [
    'CINQUIEME C',
    'TROISIEME B',
    'TERMINALE B',
    '6e',
    '4ème A',
    '2de 3',
    '1ère G',
    'Tle B',
    'Seconde',
    'Première',
  ])
    assert.equal(isSecondary(label), true, label);
  for (const label of [
    'COURS ELEMENTAIRE 2° AN 2',
    'MATERNELLE 3 MG',
    'CM2',
    'CE1',
    'CP',
    'Grande section',
    'BTS 1',
    '',
  ])
    assert.equal(isSecondary(label), false, label);
});

test('couleurs selon le barème, seuils et valeurs non numériques', () => {
  assert.equal(gradeBand(n(7, 10)), 'good');
  assert.equal(gradeBand(n(5, 10)), 'average');
  assert.equal(gradeBand(n(9.99)), 'poor');
  assert.equal(gradeBand(n(13.99)), 'average');
  assert.equal(gradeBand(n(14)), 'good');
  assert.equal(gradeBand(n(0)), 'poor');
  assert.equal(gradeBand(n(null)), 'neutral');
  assert.equal(gradeBand(n(2, 0)), 'neutral');
  assert.equal(gradeBand({ ...n(18), excluded: true }), 'neutral');
});

test('photos HTTPS ÉcoleDirecte seulement', () => {
  assert.equal(
    photoUrl('//doc1.ecoledirecte.com/PhotoEleves/test.jpg'),
    'https://doc1.ecoledirecte.com/PhotoEleves/test.jpg',
  );
  for (const url of [
    'javascript:alert(1)',
    'https://ecoledirecte.com.evil.test/a.jpg',
    'http://doc1.ecoledirecte.com/a.jpg',
    'https://user:secret@ecoledirecte.com/a.jpg',
    null,
  ])
    assert.equal(photoUrl(url), null);
});

test('conversion sur 20 des notes et moyennes, sans inventer les valeurs absentes', () => {
  assert.equal(toTwenty(7.5, 10), 15);
  assert.equal(toTwenty(4.67, 5), 18.68);
  assert.equal(toTwenty(0, 20), 0);
  assert.equal(toTwenty(15, 20), 15);
  const invalid: [unknown, unknown][] = [
    [null, 20],
    [12, 0],
    [12, null],
    ['ABS', 20],
    [12, -1],
    [NaN, 20],
  ];
  for (const [v, b] of invalid) assert.equal(toTwenty(v as number, b as number), null);
});

test('prochain jour de semaine en heure de Paris, vendredi et weekend vers lundi', () => {
  for (const [input, expected] of [
    ['2026-11-05T12:00:00Z', '2026-11-06'],
    ['2026-11-06T12:00:00Z', '2026-11-09'],
    ['2026-11-07T12:00:00Z', '2026-11-09'],
    ['2026-11-08T12:00:00Z', '2026-11-09'],
    ['2026-11-09T12:00:00Z', '2026-11-10'],
    ['2026-11-08T23:30:00Z', '2026-11-10'],
  ] as const)
    assert.equal(nextSchoolDay(new Date(input)), expected);
});

test('matière parente et sous-matière résolues par code et période', () => {
  const periodes = [
    {
      codePeriode: 'T1',
      ensembleMatieres: {
        disciplines: [
          { codeMatiere: 'ANG', codeSousMatiere: '', discipline: 'ANGLAIS LV1', sousMatiere: false },
          { codeMatiere: 'ANG', codeSousMatiere: 'O', discipline: 'Oral', sousMatiere: true },
          { codeMatiere: 'ITA', codeSousMatiere: '', discipline: 'ITALIEN LV2', sousMatiere: false },
          { codeMatiere: 'ITA', codeSousMatiere: 'O', discipline: 'Oral', sousMatiere: true },
        ],
      },
    },
  ];
  const notes = normalizeNotes({
    periodes,
    notes: [
      { codePeriode: 'T1', codeMatiere: 'ANG', codeSousMatiere: 'O', libelleMatiere: 'Oral' },
      { codePeriode: 'T1', codeMatiere: 'ITA', codeSousMatiere: 'O', libelleMatiere: 'Oral' },
    ],
  }).notes;
  assert.equal(notes[0]?.subject, 'ANGLAIS LV1 · Oral');
  assert.equal(notes[1]?.subject, 'ITALIEN LV2 · Oral');
  assert.notEqual(notes[0]?.subjectId, notes[1]?.subjectId);
});

test('sous-matière sans référentiel : code parent explicite, aucune matière inventée', () => {
  const notes = normalizeNotes({
    notes: [
      { codeMatiere: 'XYZ', codeSousMatiere: 'E', libelleMatiere: 'Ecrit' },
      { codeMatiere: 'MAT', libelleMatiere: 'Mathématiques' },
    ],
  }).notes;
  assert.equal(notes[0]?.subject, 'XYZ · Ecrit');
  assert.equal(notes[1]?.subject, 'Mathématiques');
});
