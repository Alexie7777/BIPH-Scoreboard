/**
 * 现代转播风模板 —— 渐变底 + 蓝色主色,适合投影与直播。
 */
import { BoardCore, type BoardProps } from './BoardCore';

export function BroadcastBoard({ stretch, ...rest }: BoardProps) {
  return (
    <div className={`board-canvas tpl-broadcast${stretch ? ' stretch' : ''}`}>
      <BoardCore {...rest} accent="#eaf2ff" />
    </div>
  );
}

export default BroadcastBoard;
