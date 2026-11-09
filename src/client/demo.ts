/**
 * Données fictives du mode démonstration.
 *
 * Rôle : permettre de découvrir Orbite sans compte ÉcoleDirecte, et vérifier
 * l'interface (cartes, courbes, devoirs, tableau des notes) avec des données
 * réalistes. Activé par le bouton « Mode démonstration » de `app.ts`.
 *
 * Fonctionnement : `demoData()` construit un `Dashboard` au même format que
 * `/api/dashboard`, avec des dates relatives à aujourd'hui pour que tendances,
 * notes de la semaine et devoirs à venir soient toujours remplis. Les notes
 * suivent une sinusoïde déterministe (aucun aléa) : l'affichage est identique à
 * chaque ouverture.
 *
 * Points d'attention :
 * - Six élèves volontairement variés : trois du secondaire (dont un en baisse
 *   pour illustrer les alertes) et trois du primaire, qui doivent être masqués
 *   par le filtre `isSecondary` (la dernière, en grande section, n'a même aucune note).
 * - Aucun appel réseau : en démonstration, l'IA renvoie un texte fixe
 *   (`loadCoaching` dans `app.ts`).
 * - Toute évolution des types partagés doit être répercutée ici (le
 *   typage le signale).
 *
 * Liens : `src/client/app.ts`, `src/shared/types.ts`, `src/shared/metrics.ts`.
 */
import { nextSchoolDay } from '../shared/metrics.ts';
import type { Dashboard, Homework, Note } from '../shared/types.ts';

export function demoData(): Dashboard {
  const names = ['Gabriel', 'Louise', 'Arthur', 'Alice', 'Louis', 'Jeanne'];
  const classes = ['Terminale', '3e', '5e', 'CM2', 'CE1', 'Grande section'];
  const subjects = ['Mathématiques', 'Français', 'Histoire-géo', 'Anglais', 'Physique-chimie', 'SVT'];
  const titles = ['Contrôle de connaissances', 'Évaluation de chapitre', 'Devoir maison', 'Expression écrite'];
  const instructions = [
    'Exercices 4 et 5 page 82. Justifier chaque réponse.',
    'Relire le chapitre et apprendre les définitions.',
    'Préparer une présentation orale de deux minutes.',
  ];
  const today = new Date();
  // Année scolaire en cours : avant septembre (mois 8), elle a commencé l'année précédente.
  const year = today.getMonth() < 8 ? today.getFullYear() - 1 : today.getFullYear();
  const start = `${year}-09-01`;
  const end = `${year + 1}-07-10`;
  return {
    demo: true,
    updatedAt: today.toISOString(),
    children: names.map((name, c) => {
      const notes: Note[] =
        c === 5
          ? []
          : Array.from({ length: 42 }, (_, i) => {
              const subject = subjects[i % 6] ?? '';
              // Une série de six matières tous les 8 jours environ, la plus récente il y a 2 jours.
              const ago = 2 + Math.floor(i / 6) * 8 + (i % 3);
              const date = new Date(today);
              date.setDate(today.getDate() - ago);
              // Note au demi-point entre 5 et 20. Les 18 plus récentes (≈ 3 semaines) sont
              // décalées : +1,8 pour tous, -2 pour Arthur (c = 2), qui produit ainsi une tendance à la baisse.
              const value = Math.min(
                20,
                Math.max(
                  5,
                  Math.round((13.6 + c * 0.4 + Math.sin(i * 2.7 + c) * 3 + (i < 18 ? (c === 2 ? -2 : 1.8) : 0)) * 2) /
                    2,
                ),
              );
              return {
                id: c * 100 + i,
                subject,
                subjectId: String(i % 6),
                title: titles[i % 4] ?? '',
                date: date.toISOString().slice(0, 10),
                period: 'demo',
                value,
                raw: String(value),
                outOf: 20,
                coefficient: i % 4 === 0 ? 2 : 1,
                classAverage: Math.round((11.5 + Math.sin(i) * 1.5) * 10) / 10,
                excluded: false,
              };
            });
      const homework: Homework[] = Array.from({ length: 3 - (c % 3) }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() + i * 2);
        // Le premier devoir tombe au prochain jour ouvré pour montrer le marquage « urgent ».
        if (i === 0) d.setTime(new Date(nextSchoolDay(today) + 'T12:00:00Z').getTime());
        return {
          id: 'hw-' + c + '-' + i,
          dueDate: d.toLocaleDateString('en-CA'),
          subject: subjects[(c + i) % 6] ?? '',
          text: instructions[i] ?? '',
          status: 'pending',
          exam: i === 1,
          documents: [],
        };
      });
      const homeworkDates = [...new Set(homework.map((h) => h.dueDate))]
        .sort()
        .map((date) => ({ date, done: 4, total: 4 + homework.filter((h) => h.dueDate === date).length, unknown: 0 }));
      return {
        homework,
        homeworkDates,
        homeworkNext: null,
        id: 'demo-' + c,
        name,
        className: classes[c] ?? '',
        school: 'Établissement de démonstration',
        notes,
        periods: [{ id: 'demo', label: 'Période de démonstration', start, end, average: null, classAverage: null }],
      };
    }),
  };
}
