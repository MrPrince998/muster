import { checkAnswers, prepareQuestions, type Question } from './questions.js';

const diet: Question = { id: 'diet', label: 'Dietary needs', kind: 'choice', options: ['None', 'Vegetarian', 'Vegan'], required: true };
const note: Question = { id: 'note', label: 'Anything else?', kind: 'text', options: [], required: false };

describe('registration questions', () => {
  it('keeps the ids of questions already asked, and gives new ones their own', () => {
    const prepared = prepareQuestions(
      [
        { id: 'diet', label: ' Dietary needs ', kind: 'choice', options: ['None', 'Vegan', 'Vegan', ' '], required: true },
        { id: 'made-up', label: 'Size', kind: 'text' },
      ],
      [diet],
    );
    expect(prepared[0]).toEqual({ id: 'diet', label: 'Dietary needs', kind: 'choice', options: ['None', 'Vegan'], required: true });
    expect(prepared[1].id).not.toBe('made-up');
    expect(prepared[1]).toMatchObject({ label: 'Size', kind: 'text', options: [], required: false });
  });

  it('refuses a choice with fewer than two options, and more than five questions', () => {
    expect(() => prepareQuestions([{ label: 'Size', kind: 'choice', options: ['M'] }])).toThrow(/at least two choices/);
    expect(() => prepareQuestions(Array.from({ length: 6 }, () => ({ label: 'Q', kind: 'text' as const })))).toThrow(/Up to 5/);
  });

  it('takes answers that fit, trimmed, and drops ones nobody asked for', () => {
    expect(checkAnswers([diet, note], { diet: 'Vegan', note: '  Allergic to nuts ', extra: 'x' })).toEqual({
      diet: 'Vegan',
      note: 'Allergic to nuts',
    });
    expect(checkAnswers([diet, note], { diet: 'None' })).toEqual({ diet: 'None' });
  });

  it('names the questions that need another look', () => {
    expect(() => checkAnswers([diet], {})).toThrow('"Dietary needs" is required');
    expect(() => checkAnswers([diet], { diet: 'Carnivore' })).toThrow('"Dietary needs" is not one of the choices');
    expect(() => checkAnswers([note], { note: 'x'.repeat(301) })).toThrow(/longer than 300/);
  });
});
