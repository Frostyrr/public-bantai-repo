import Input from "../ui/Input";
import Select from "../ui/Select";
import { recoveryQuestions } from "../../lib/securityQuestions";

export default function RecoveryQuestionFields({
  questions,
  answers,
  onQuestions,
  onAnswers,
  disabled,
  review = false,
}: {
  questions: number[];
  answers: string[];
  onQuestions?: (questions: number[]) => void;
  onAnswers: (answers: string[]) => void;
  disabled?: boolean;
  review?: boolean;
}) {
  return (
    <div className="recovery-question-fields space-y-5">
      {questions.map((id, index) => (
        <div key={index} className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-secondary">
            Question {index + 1} of 3
          </p>
          {onQuestions && !review ? (
            <Select
              label={`Choose question ${index + 1}`}
              value={String(id)}
              disabled={disabled}
              options={recoveryQuestions.flatMap((question, i) =>
                !questions.includes(i + 1) || id === i + 1
                  ? [{ value: String(i + 1), label: question }]
                  : [],
              )}
              onChange={(event) =>
                onQuestions(
                  questions.map((q, i) =>
                    i === index ? Number(event.target.value) : q,
                  ),
                )
              }
            />
          ) : (
            <p className="text-sm font-medium text-primary">
              {recoveryQuestions[id - 1]}
            </p>
          )}
          <Input
            label={`Answer ${index + 1}`}
            type="password"
            visibilityLabel={`answer ${index + 1}`}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={2}
            maxLength={200}
            readOnly={review}
            disabled={disabled}
            value={answers[index] ?? ""}
            onChange={(event) =>
              onAnswers(
                answers.map((answer, i) =>
                  i === index ? event.target.value : answer,
                ),
              )
            }
          />
        </div>
      ))}
      <p className="text-xs leading-relaxed text-secondary">
        Capitalization and extra spaces don’t matter. Spelling does. Choose
        answers you can remember.
      </p>
    </div>
  );
}
