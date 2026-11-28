import { jsonrepair } from 'jsonrepair';

export type QuestionJsonItem = {
  question: string;
  options: string[];
  correct_answer: string | null;
};

export type QuestionJsonRoot = { questions: QuestionJsonItem[] };

export type ImportIssue = {
  path: string;
  message: string;
  code?: 'duplicate_question' | 'missing_question' | 'invalid_options' | 'invalid_correct_answer' | 'extra_fields' | 'missing_fields' | 'invalid_item' | 'invalid_root';
  questionIndex?: number;
  duplicateOfIndex?: number;
};

export type ParseResult = {
  value: unknown;
  repaired: boolean;
  correctedText: string | null;
  syntaxError: string | null;
};

export function stripJsonFence(input: string): string {
  return input
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^`{3}(?:json)?[ \t]*\r?\n?/i, '')
    .replace(/\r?\n?[ \t]*`{3}[ \t]*$/, '')
    .trim();
}

export function parseQuestionJson(input: string): ParseResult {
  const cleaned = stripJsonFence(input);
  try {
    return { value: JSON.parse(cleaned) as unknown, repaired: false, correctedText: null, syntaxError: null };
  } catch (error) {
    const syntaxError = error instanceof Error ? error.message : 'Invalid JSON syntax.';
    const correctedText = jsonrepair(cleaned);
    return { value: JSON.parse(correctedText) as unknown, repaired: true, correctedText, syntaxError };
  }
}

const normalize = (value: string) =>
  value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

export function validateQuestionJson(value: unknown): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ path: '$', code: 'invalid_root', message: 'Root must be an object containing a questions array.' }];
  }

  const root = value as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !Object.prototype.hasOwnProperty.call(root, 'questions')) {
    issues.push({ path: '$', code: 'extra_fields', message: 'Root must contain exactly one key: questions.' });
  }
  if (!Array.isArray(root.questions) || root.questions.length === 0) {
    issues.push({ path: 'questions', code: 'invalid_root', message: 'questions must be a non-empty array.' });
    return issues;
  }

  const firstQuestionIndex = new Map<string, number>();
  root.questions.forEach((raw, index) => {
    const path = `questions[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ path, code: 'invalid_item', questionIndex: index, message: 'Each question must be an object.' });
      return;
    }

    const item = raw as Record<string, unknown>;
    const allowed = ['question', 'options', 'correct_answer'];
    const extra = Object.keys(item).filter(key => !allowed.includes(key));
    const missing = allowed.filter(key => !Object.prototype.hasOwnProperty.call(item, key));
    if (extra.length) issues.push({ path, code: 'extra_fields', questionIndex: index, message: `Unexpected field(s): ${extra.join(', ')}.` });
    if (missing.length) issues.push({ path, code: 'missing_fields', questionIndex: index, message: `Missing field(s): ${missing.join(', ')}.` });

    if (typeof item.question !== 'string' || !item.question.trim()) {
      issues.push({ path: `${path}.question`, code: 'missing_question', questionIndex: index, message: 'Must be a non-empty string.' });
    } else {
      const key = normalize(item.question);
      const duplicateOfIndex = firstQuestionIndex.get(key);
      if (duplicateOfIndex !== undefined) {
        issues.push({
          path: `${path}.question`,
          code: 'duplicate_question',
          questionIndex: index,
          duplicateOfIndex,
          message: `Duplicate question. It matches question ${duplicateOfIndex + 1}.`,
        });
      } else {
        firstQuestionIndex.set(key, index);
      }
    }

    if (!Array.isArray(item.options) || item.options.length < 2 ||
        item.options.some(option => typeof option !== 'string' || !option.trim())) {
      issues.push({ path: `${path}.options`, code: 'invalid_options', questionIndex: index, message: 'Must be an array of at least two non-empty strings.' });
    } else if (new Set(item.options.map(option => normalize(option))).size !== item.options.length) {
      issues.push({ path: `${path}.options`, code: 'invalid_options', questionIndex: index, message: 'Duplicate options detected.' });
    }

    if (item.correct_answer !== null && typeof item.correct_answer !== 'string') {
      issues.push({ path: `${path}.correct_answer`, code: 'invalid_correct_answer', questionIndex: index, message: 'Must be a string or null.' });
    } else if (typeof item.correct_answer === 'string' &&
               Array.isArray(item.options) && !item.options.includes(item.correct_answer)) {
      issues.push({ path: `${path}.correct_answer`, code: 'invalid_correct_answer', questionIndex: index, message: 'Must exactly match one of the option strings.' });
    }
  });

  return issues;
}
