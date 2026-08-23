import { describe, it, expect } from 'vitest';
import {
  mentionDe, appreciationDe, propositionsConseil,
  moyenneMatiere, moyenneGenerale,
} from '../src/metier/bareme.js';

/**
 * TESTS UNITAIRES — les regles de notation, isolees.
 *
 * Aucune base, aucun HTTP : on verifie le calcul lui-meme, y compris aux
 * bornes ou les bugs se cachent (exactement 10, exactement 16, note nulle).
 */

describe('mentionDe', () => {
  it('rend la mention attendue par palier', () => {
    expect(mentionDe(18)).toBe('Tres bien');
    expect(mentionDe(15)).toBe('Bien');
    expect(mentionDe(13)).toBe('Assez bien');
    expect(mentionDe(11)).toBe('Passable');
    expect(mentionDe(7)).toBe('Insuffisant');
  });

  it('place les bornes du bon cote', () => {
    // Une moyenne pile a 16 doit valoir « Tres bien », pas « Bien »
    expect(mentionDe(16)).toBe('Tres bien');
    expect(mentionDe(15.99)).toBe('Bien');
    expect(mentionDe(10)).toBe('Passable');
    expect(mentionDe(9.99)).toBe('Insuffisant');
  });

  it('ne rend rien sans moyenne', () => {
    expect(mentionDe(null)).toBeNull();
    expect(mentionDe(undefined)).toBeNull();
  });
});

describe('appreciationDe', () => {
  it('rend l appreciation du bulletin officiel', () => {
    expect(appreciationDe(19)).toBe('Excellent travail');
    expect(appreciationDe(17)).toBe('Tres Bon Travail');
    expect(appreciationDe(14.5)).toBe('Bon Travail');
    expect(appreciationDe(12)).toBe('Assez Bon Travail');
    expect(appreciationDe(10)).toBe('Travail Passable');
    expect(appreciationDe(9)).toBe('Doit fournir plus d efforts');
    expect(appreciationDe(4)).toBe('Travail Insuffisant');
  });

  it('ne rend rien pour une valeur absente ou invalide', () => {
    expect(appreciationDe(null)).toBeNull();
    expect(appreciationDe('abc')).toBeNull();
  });
});

describe('propositionsConseil', () => {
  it('propose felicitations a partir de 16', () => {
    expect(propositionsConseil(17)).toEqual({
      appreciation: 'satisfaisant', distinction: 'felicitations',
    });
  });

  it('propose le redoublement sous 8', () => {
    expect(propositionsConseil(6)).toEqual({
      appreciation: 'risque_redoubler', distinction: 'avertissement',
    });
  });

  it('gradue les paliers intermediaires', () => {
    expect(propositionsConseil(14).distinction).toBe('tableau_honneur');
    expect(propositionsConseil(12).distinction).toBe('encouragement');
    expect(propositionsConseil(11).appreciation).toBe('peut_mieux_faire');
    expect(propositionsConseil(11).distinction).toBeNull();
    expect(propositionsConseil(9).appreciation).toBe('insuffisant');
  });

  it('ne propose RIEN sans moyenne', () => {
    // Un eleve nouvellement inscrit, sans note : suggerer un redoublement
    // faute de notes serait injuste. Bug rencontre en production.
    expect(propositionsConseil(null)).toEqual({
      appreciation: null, distinction: null,
    });
    expect(propositionsConseil('')).toEqual({
      appreciation: null, distinction: null,
    });
  });
});

describe('moyenneMatiere', () => {
  it('pondere par le coefficient de chaque epreuve', () => {
    // devoir 10 (coef 1) + composition 16 (coef 2) = (10 + 32) / 3 = 14
    expect(moyenneMatiere([
      { valeur: 10, bareme: 20, coefficient: 1 },
      { valeur: 16, bareme: 20, coefficient: 2 },
    ])).toBe(14);
  });

  it('ramene sur 20 quand le bareme differe', () => {
    // 30/40 vaut 15/20
    expect(moyenneMatiere([{ valeur: 30, bareme: 40, coefficient: 1 }])).toBe(15);
  });

  it('EXCLUT les notes nulles au lieu de les compter zero', () => {
    // Absent a la composition : la moyenne reste celle du devoir, 12.
    // La compter zero donnerait 6 et penaliserait l eleve a tort.
    expect(moyenneMatiere([
      { valeur: 12, bareme: 20, coefficient: 1 },
      { valeur: null, bareme: 20, coefficient: 1 },
    ])).toBe(12);
  });

  it('rend null quand aucune note n est chiffree', () => {
    expect(moyenneMatiere([{ valeur: null, bareme: 20, coefficient: 1 }])).toBeNull();
    expect(moyenneMatiere([])).toBeNull();
  });
});

describe('moyenneGenerale', () => {
  it('pondere par le coefficient de la matiere', () => {
    // (15*4 + 10*2) / 6 = 13.33
    expect(moyenneGenerale([
      { moyenne: 15, coefficient: 4 },
      { moyenne: 10, coefficient: 2 },
    ])).toBe(13.33);
  });

  it('ignore une matiere sans moyenne', () => {
    expect(moyenneGenerale([
      { moyenne: 14, coefficient: 2 },
      { moyenne: null, coefficient: 5 },
    ])).toBe(14);
  });

  it('rend null si aucune matiere n a de moyenne', () => {
    expect(moyenneGenerale([{ moyenne: null, coefficient: 3 }])).toBeNull();
  });
});
