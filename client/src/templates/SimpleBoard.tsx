/**
 * 简洁大比分模板 —— 校赛最常用,信息密度高、留白干净。
 */
import { BoardCore, type BoardProps } from './BoardCore';

export function SimpleBoard({ stretch, ...rest }: BoardProps) {
  return (
    <div className={`board-canvas tpl-simple${stretch ? ' stretch' : ''}`}>
      <BoardCore {...rest} accent="#ffb020" />
    </div>
  );
}

export default SimpleBoard;
