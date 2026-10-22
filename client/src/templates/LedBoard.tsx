/**
 * 复古 LED 模板 —— 琥珀色数码管 + 发光描边。
 */
import { BoardCore, type BoardProps } from './BoardCore';

export function LedBoard({ stretch, ...rest }: BoardProps) {
  return (
    <div className={`board-canvas tpl-led${stretch ? ' stretch' : ''}`}>
      <BoardCore {...rest} accent="#ffb000" />
    </div>
  );
}

export default LedBoard;
