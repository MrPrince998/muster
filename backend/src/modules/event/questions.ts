import { randomBytes } from 'node:crypto';
import { HttpError } from '../../common/errors/http-error.js';

/**
 * Questions an event asks the people taking a place: short text, or one
 * choice from a list. Kept on the event (events.questions); the answers go
 * with the place, keyed by question id, so renaming a question keeps them.
 */
export interface Question {
  id: string;
  label: string;
  kind: 'text' | 'choice';
  // the choices, for a choice question
  options: string[];
  required: boolean;
}

export const MAX_QUESTIONS = 5;
export const MAX_ANSWER = 300;

/**
 * The questions as the organiser set them, made ready to keep: a question
 * that was there before keeps its id (and so its answers); a new one gets one.
 */
export function prepareQuestions(
  input: { id?: string; label: string; kind: 'text' | 'choice'; options?: string[]; required?: boolean }[],
  existing: Question[] = [],
): Question[] {
  if (input.length > MAX_QUESTIONS) {
    throw HttpError.badRequest(`Up to ${MAX_QUESTIONS} questions`, 'TOO_MANY_QUESTIONS');
  }
  const known = new Set(existing.map((q) => q.id));
  return input.map((q) => {
    const options = q.kind === 'choice' ? [...new Set((q.options ?? []).map((o) => o.trim()).filter(Boolean))] : [];
    if (q.kind === 'choice' && options.length < 2) {
      throw HttpError.badRequest(`"${q.label}" needs at least two choices`, 'QUESTION_NEEDS_CHOICES');
    }
    return {
      id: q.id && known.has(q.id) ? q.id : randomBytes(6).toString('base64url'),
      label: q.label.trim(),
      kind: q.kind,
      options,
      required: !!q.required,
    };
  });
}

/**
 * Someone's answers, checked against the event's questions: required ones
 * answered, choices from the list, text not too long. Answers to questions
 * the event doesn't ask are dropped. Throws INVALID_ANSWERS, naming each
 * question that's wrong.
 */
export function checkAnswers(questions: Question[], given: Record<string, unknown> | undefined): Record<string, string> {
  const answers: Record<string, string> = {};
  const problems: { questionId: string; label: string; problem: string }[] = [];
  for (const q of questions) {
    const raw = given?.[q.id];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      if (q.required) problems.push({ questionId: q.id, label: q.label, problem: 'required' });
      continue;
    }
    if (q.kind === 'choice' && !q.options.includes(value)) {
      problems.push({ questionId: q.id, label: q.label, problem: 'not one of the choices' });
      continue;
    }
    if (value.length > MAX_ANSWER) {
      problems.push({ questionId: q.id, label: q.label, problem: `longer than ${MAX_ANSWER} characters` });
      continue;
    }
    answers[q.id] = value;
  }
  if (problems.length > 0) {
    throw HttpError.badRequest(
      problems.length === 1 ? `"${problems[0].label}" is ${problems[0].problem}` : 'Some answers need another look',
      'INVALID_ANSWERS',
      { problems },
    );
  }
  return answers;
}
