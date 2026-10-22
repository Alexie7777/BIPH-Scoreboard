/**
 * 操作提示(toast)的文案生成。
 * ------------------------------------------------------------------
 * 【一条原则:提示只说"做了什么",不说"变成了什么样"】
 *
 * 为什么:现场是连点着用的。点「+2」之后服务端的广播还没回来,
 * 此时界面上的比分还是旧的 —— 如果提示里写"当前 12:8",
 * 那这条提示就可能是个假数字,比没有提示更误导人。
 *
 * 比分、节次、剩余暂停次数这些"结果",队卡和大屏上本来就看得到,
 * 不需要提示重复一遍。提示只负责回答一件事:【你刚才那一下,生效了没有】。
 *
 * 队伍名是唯一的例外:它来自比赛配置,整场不变,写进提示是安全的。
 */
import type { CommandType, Match, Side } from '@biph/shared';
import type { MessageKey, Vars } from '../i18n';

export interface ToastAction {
  /** i18n 键 */
  key: MessageKey;
  /** 变量(在【发送时】用当时的比赛快照生成,渲染时才翻译) */
  vars?: Vars;
}

function teamName(m: Match | null, side: Side): string {
  if (!m) return '';
  const t = side === 'home' ? m.home : m.away;
  return t.name || t.shortName;
}

function sideOf(payload: Record<string, unknown>): Side {
  return payload.side === 'away' ? 'away' : 'home';
}

/** 毫秒 → 带符号的秒数(+30 / -10) */
function signedSeconds(deltaMs: unknown): string {
  const sec = Math.round(Number(deltaMs ?? 0) / 1000);
  return `${sec >= 0 ? '+' : ''}${sec}`;
}

/**
 * 按命令类型生成提示文案。
 *
 * @param type    命令类型
 * @param payload 命令参数
 * @param match   【发送那一刻】的比赛快照(用来取队伍名)
 * @returns 要显示的文案;null = 这条命令不需要提示
 */
export function describeCommand(
  type: CommandType,
  payload: unknown,
  match: Match | null,
): ToastAction | null {
  const p = (payload ?? {}) as Record<string, unknown>;

  switch (type) {
    /* ------------------------------ 比赛钟 ------------------------------ */
    case 'clock.start':
      return { key: 'toast.clock.started' };
    case 'clock.pause':
      return { key: 'toast.clock.paused' };
    case 'clock.toggle':
      // 切换的语义取决于"按下之前"的状态,所以要看快照
      return { key: match?.clock.running ? 'toast.clock.paused' : 'toast.clock.started' };
    case 'clock.adjust':
      return { key: 'toast.clock.adjust', vars: { delta: signedSeconds(p.deltaMs) } };
    case 'clock.set':
      return { key: 'toast.clock.set' };
    case 'clock.nextPeriod':
      return { key: 'toast.clock.period' };
    case 'clock.prevPeriod':
      return { key: 'toast.clock.periodBack' };

    /* ------------------------------ 进攻钟 ------------------------------ */
    case 'shot.start':
      return { key: 'toast.shot.started' };
    case 'shot.pause':
      return { key: 'toast.shot.paused' };
    case 'shot.toggle':
      return { key: match?.shotClock.running ? 'toast.shot.paused' : 'toast.shot.started' };
    case 'shot.adjust':
      return { key: 'toast.shot.adjust', vars: { delta: signedSeconds(p.deltaMs) } };
    case 'shot.set':
    case 'shot.reset':
      return { key: 'toast.shot.reset' };

    /* ------------------------------- 比分 ------------------------------- */
    case 'score.add': {
      const side = sideOf(p);
      return {
        key: 'toast.score.add',
        vars: { team: teamName(match, side), points: String(p.points ?? 1) },
      };
    }
    case 'score.sub': {
      const side = sideOf(p);
      return {
        key: 'toast.score.sub',
        vars: { team: teamName(match, side), points: String(p.points ?? 1) },
      };
    }

    /* ----------------------------- 犯规/暂停 ---------------------------- */
    case 'foul.add':
      return { key: 'toast.foul.add', vars: { team: teamName(match, sideOf(p)) } };
    case 'foul.sub':
      return { key: 'toast.foul.sub', vars: { team: teamName(match, sideOf(p)) } };
    case 'timeout.add':
      return { key: 'toast.timeout.add', vars: { team: teamName(match, sideOf(p)) } };
    case 'timeout.sub':
      return { key: 'toast.timeout.sub', vars: { team: teamName(match, sideOf(p)) } };
    case 'timeout.request':
      return { key: 'toast.timeout.request', vars: { team: teamName(match, sideOf(p)) } };
    case 'timeout.end':
      return { key: 'toast.timeout.end' };

    /* ------------------------------- 比赛 ------------------------------- */
    case 'possession.set': {
      const side = p.side === null || p.side === undefined ? null : sideOf(p);
      if (!side) return { key: 'toast.possession.none' };
      return { key: 'toast.possession', vars: { team: teamName(match, side) } };
    }
    case 'sides.swap':
      return { key: 'toast.sides.swap' };
    case 'match.status': {
      const st = p.status;
      if (st === 'live') return { key: 'toast.match.live' };
      if (st === 'finished') return { key: 'toast.match.finished' };
      return { key: 'toast.match.scheduled' };
    }
    case 'match.final':
      return { key: 'toast.match.finished' };
    case 'buzzer':
      return { key: 'toast.buzzer' };
    case 'undo':
      return { key: 'toast.undo' };

    /*
     * match.update 不弹提示:
     * 控制台只用它切语言,弹一句"更新比赛配置"纯属噪声。
     * 配置页走的是 REST 通道,自己有一套提示。
     */
    case 'match.update':
      return null;

    default:
      return null;
  }
}
