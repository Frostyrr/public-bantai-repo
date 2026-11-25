export const recoveryQuestions = [
  "What was the name of your first pet?",
  "Who was your best friend in elementary school?",
  "Who was your favorite teacher in high school?",
  "What is your mother’s maiden first name?",
  "What street did you live on in Grade 1?",
  "What was the first song you learned by heart?",
  "What was the name of your elementary school?",
  "What dish did you cook for the first time?",
] as const;
export type ManagedHistoryStatus={bootstrap:boolean;pending:boolean;stale:boolean;coverageGap:number;needsReconciliation:boolean;paused?:boolean};
export type QuestionStatus = { eligible?: boolean; enabled: boolean; questions: number[]; managedHistory?:ManagedHistoryStatus };
export type QuestionRequest = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
