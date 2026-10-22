/**
 * 操作提示栈(右上角)。
 * ------------------------------------------------------------------
 * 现场计分时,按完按钮必须马上知道"到底生效了没有" ——
 * 这一摞提示就是干这件事的:绿色对勾 = 生效,红色 = 被服务端拒绝。
 *
 * 点一下可以立刻把它划掉,不用等它自己消失。
 */
export type ToastKind = 'ok' | 'err';

export interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

export interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-item ${t.kind}`}
          onClick={() => onDismiss(t.id)}
        >
          <span className="toast-mark" aria-hidden="true">
            {t.kind === 'ok' ? '✓' : '!'}
          </span>
          <span className="toast-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export default ToastStack;
