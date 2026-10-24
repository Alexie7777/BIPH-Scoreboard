/**
 * 命令归约层(applyCommand)的单元测试。
 *
 * 这里测的是"计分员点一下按钮之后,比赛状态到底变成什么"——
 * 计时数学在 clock.test.ts 里测,这里测状态机与规则约束。
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, rejectReason, resetMatch } from '../src/match.js';

const T0 = 1_700_000_000_000;

function freshMatch(overrides: Parameters<typeof createMatch>[0] = {}) {
  return createMatch({ name: '校赛A场', homeName: '猛虎队', awayName: '飞鹰队', ...overrides }, T0, 'test-match');
}

describe('建赛', () => {
  it('新比赛比分/犯规从 0 开始,暂停从额度满值开始(计数=剩余次数)', () => {
    const m = freshMatch({ rules: { timeoutsPerTeam: 4, bonusFouls: 5 } });
    expect(m.home.score).toBe(0);
    expect(m.away.score).toBe(0);
    expect(m.home.fouls).toBe(0);
    expect(m.home.timeouts).toBe(4);
    expect(m.away.timeouts).toBe(4);
    expect(m.rules.timeoutsPerTeam).toBe(4);
    expect(m.status).toBe('scheduled');
  });

  it('重置会清空比分/犯规,但暂停额度回到满值,队名与规则保留', () => {
    let m = freshMatch();
    m = applyCommand(m, 'score.add', { side: 'home', points: 3 }, T0).match;
    m = applyCommand(m, 'foul.add', { side: 'away' }, T0).match;
    m = applyCommand(m, 'timeout.add', { side: 'home' }, T0).match;

    const r = resetMatch(m, T0);
    expect(r.home.score).toBe(0);
    expect(r.away.fouls).toBe(0);
    expect(r.home.timeouts).toBe(4);
    expect(r.home.name).toBe('猛虎队');
    expect(r.rules.periodMinutes).toBe(m.rules.periodMinutes);
  });
});

describe('比分', () => {
  it('加分按分值累加,减分只减 1 且不会变成负数', () => {
    let m = freshMatch();
    m = applyCommand(m, 'score.add', { side: 'home', points: 3 }, T0).match;
    m = applyCommand(m, 'score.add', { side: 'away', points: 2 }, T0).match;
    expect(m.home.score).toBe(3);
    expect(m.away.score).toBe(2);

    m = applyCommand(m, 'score.sub', { side: 'home' }, T0).match;
    expect(m.home.score).toBe(2);

    m = applyCommand(m, 'score.sub', { side: 'home' }, T0).match;
    m = applyCommand(m, 'score.sub', { side: 'home' }, T0).match;
    m = applyCommand(m, 'score.sub', { side: 'home' }, T0).match;
    expect(m.home.score).toBe(0);
  });
});

describe('犯规', () => {
  it('可以加减,且不会变成负数', () => {
    let m = freshMatch();
    m = applyCommand(m, 'foul.add', { side: 'home' }, T0).match;
    m = applyCommand(m, 'foul.add', { side: 'home' }, T0).match;
    expect(m.home.fouls).toBe(2);
    m = applyCommand(m, 'foul.sub', { side: 'home' }, T0).match;
    expect(m.home.fouls).toBe(1);
    m = applyCommand(m, 'foul.sub', { side: 'home' }, T0).match;
    m = applyCommand(m, 'foul.sub', { side: 'home' }, T0).match;
    expect(m.home.fouls).toBe(0);
  });

  it('达到 BONUS 阈值后仍然继续累加(阈值只是提醒,不是上限)', () => {
    let m = freshMatch({ rules: { bonusFouls: 5 } });
    for (let i = 0; i < 7; i++) m = applyCommand(m, 'foul.add', { side: 'home' }, T0).match;
    expect(m.home.fouls).toBe(7);
  });
});

describe('暂停计数', () => {
  it('计数是"剩余次数":用掉一次减一,用光了不能再减', () => {
    let m = freshMatch({ rules: { timeoutsPerTeam: 4 } });
    expect(m.home.timeouts).toBe(4);

    m = applyCommand(m, 'timeout.add', { side: 'home' }, T0).match;
    expect(m.home.timeouts).toBe(3);

    for (let i = 0; i < 3; i++) m = applyCommand(m, 'timeout.add', { side: 'home' }, T0).match;
    expect(m.home.timeouts).toBe(0);

    // 已经没有暂停了,再点也不能变成负数
    const res = applyCommand(m, 'timeout.add', { side: 'home' }, T0);
    expect(res.match.home.timeouts).toBe(0);
    expect(res.log).toContain('用完');
  });

  it('撤销一次会把剩余加回来,但不会超过本场额度', () => {
    let m = freshMatch({ rules: { timeoutsPerTeam: 4 } });
    m = applyCommand(m, 'timeout.add', { side: 'away' }, T0).match;
    expect(m.away.timeouts).toBe(3);
    m = applyCommand(m, 'timeout.sub', { side: 'away' }, T0).match;
    expect(m.away.timeouts).toBe(4);
    // 已经满额,不能再加
    m = applyCommand(m, 'timeout.sub', { side: 'away' }, T0).match;
    expect(m.away.timeouts).toBe(4);
  });

  it('额度配成 0 表示不限制', () => {
    let m = freshMatch({ rules: { timeoutsPerTeam: 0 } });
    expect(m.home.timeouts).toBe(0);
    // 不限制时,撤销一次应该能加上去
    m = applyCommand(m, 'timeout.sub', { side: 'home' }, T0).match;
    expect(m.home.timeouts).toBe(1);
  });
});

describe('请求暂停', () => {
  it('请求暂停 = 消耗一次额度 + 暂停比赛钟与进攻钟 + 启动大屏倒计时', () => {
    let m = freshMatch({ rules: { timeoutsPerTeam: 4, timeoutSeconds: 90 } });
    // 先把表走起来。
    // 注意:开球时进攻钟会跟着比赛钟一起启动(见「进攻钟与比赛钟联动」),
    // 所以这里不用再单独 shot.toggle —— 多按一下反而会把进攻钟停了。
    m = applyCommand(m, 'clock.toggle', {}, T0).match;
    expect(m.clock.running).toBe(true);
    expect(m.shotClock.running).toBe(true);

    m = applyCommand(m, 'timeout.request', { side: 'home' }, T0 + 1000).match;

    // 暂停额度少一次
    expect(m.home.timeouts).toBe(3);
    expect(m.away.timeouts).toBe(4);
    // 两个钟都停住
    expect(m.clock.running).toBe(false);
    expect(m.shotClock.running).toBe(false);
    // 倒计时按规则里的暂停时长启动,并记下是谁叫的
    expect(m.timeout?.running).toBe(true);
    expect(m.timeout?.side).toBe('home');
    expect(m.timeout?.remainingMs).toBe(90_000);
    expect(m.timeout?.anchorServerTs).toBe(T0 + 1000);
  });

  it('暂停时长取本场规则(可以在配置页改)', () => {
    let m = freshMatch({ rules: { timeoutSeconds: 30 } });
    m = applyCommand(m, 'timeout.request', { side: 'away' }, T0).match;
    expect(m.timeout?.remainingMs).toBe(30_000);
    expect(m.timeout?.side).toBe('away');
  });

  it('没有暂停额度时不给叫(不启动倒计时,也不扣别人的次数)', () => {
    let m = freshMatch({ rules: { timeoutsPerTeam: 1 } });
    m = applyCommand(m, 'timeout.request', { side: 'home' }, T0).match;
    expect(m.timeout?.running).toBe(true);
    expect(m.home.timeouts).toBe(0);

    // 结束这次暂停(额度已经用光),再叫应当被拒绝
    m = applyCommand(m, 'timeout.end', {}, T0 + 1000).match;
    const res = applyCommand(m, 'timeout.request', { side: 'home' }, T0 + 2000);
    expect(res.log).toContain('用完');
    expect(res.match.timeout?.running).toBe(false); // 没有启动新倒计时
    expect(res.match.home.timeouts).toBe(0);
    expect(res.match.away.timeouts).toBe(1); // 客队的额度没被动过
  });

  it('已经有暂停在进行时不重复计时', () => {
    let m = freshMatch();
    m = applyCommand(m, 'timeout.request', { side: 'home' }, T0).match;
    const res = applyCommand(m, 'timeout.request', { side: 'away' }, T0 + 500);
    expect(res.log).toContain('进行中');
    expect(res.match.timeout?.side).toBe('home');
    expect(res.match.away.timeouts).toBe(4); // 客队额度没被动过
  });

  it('结束暂停撤下倒计时,但【不】自动恢复比赛钟(由计分员手动开始)', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.toggle', {}, T0).match;
    m = applyCommand(m, 'timeout.request', { side: 'home' }, T0 + 1000).match;
    expect(m.clock.running).toBe(false);

    m = applyCommand(m, 'timeout.end', {}, T0 + 2000).match;
    expect(m.timeout?.running).toBe(false);
    expect(m.timeout?.side).toBeNull();
    // 比赛钟仍然是停的 —— 球员没回场,表不能自己开始走
    expect(m.clock.running).toBe(false);
    expect(m.shotClock.running).toBe(false);

    // 计分员手动开始后才继续走
    m = applyCommand(m, 'clock.start', {}, T0 + 3000).match;
    expect(m.clock.running).toBe(true);
  });

  it('「继续比赛」会把暂停期间误按启动的表停回去', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.toggle', {}, T0).match;
    m = applyCommand(m, 'timeout.request', { side: 'home' }, T0 + 1000).match;
    expect(m.clock.running).toBe(false);

    // 暂停中有人误按了「开始」,表跑起来了
    m = applyCommand(m, 'clock.start', {}, T0 + 2000).match;
    m = applyCommand(m, 'shot.start', {}, T0 + 2000).match;
    expect(m.clock.running).toBe(true);
    expect(m.shotClock.running).toBe(true);

    // 「继续比赛」的语义是"回到比赛画面、等待开打" —— 表必须停在停止状态
    m = applyCommand(m, 'timeout.end', {}, T0 + 3000).match;
    expect(m.timeout?.running).toBe(false);
    expect(m.clock.running).toBe(false);
    expect(m.shotClock.running).toBe(false);
  });

  it('置 FINAL / 重置比赛都会把暂停倒计时一起收掉', () => {
    let m = freshMatch();
    m = applyCommand(m, 'timeout.request', { side: 'home' }, T0).match;
    expect(m.timeout?.running).toBe(true);

    m = applyCommand(m, 'match.final', {}, T0 + 1000).match;
    expect(m.timeout?.running).toBe(false);

    m = applyCommand(m, 'timeout.request', { side: 'away' }, T0 + 2000).match;
    expect(m.timeout?.running).toBe(true);
    const r = resetMatch(m, T0 + 3000);
    expect(r.timeout?.running).toBe(false);
    expect(r.timeout?.side).toBeNull();
  });
});

describe('比赛', () => {
  it('交换主客会连比分一起换', () => {
    let m = freshMatch();
    m = applyCommand(m, 'score.add', { side: 'home', points: 3 }, T0).match;
    m = applyCommand(m, 'sides.swap', {}, T0).match;
    expect(m.home.name).toBe('飞鹰队');
    expect(m.home.score).toBe(0);
    expect(m.away.name).toBe('猛虎队');
    expect(m.away.score).toBe(3);
  });

  it('交换主客时进攻权跟着队伍走,不会跑到对方头上', () => {
    let m = freshMatch();
    // 猛虎队是主队,让它持球
    m = applyCommand(m, 'possession.set', { side: 'home' }, T0).match;
    expect(m.possession).toBe('home');

    m = applyCommand(m, 'sides.swap', {}, T0).match;
    // 猛虎队换到了客位,进攻权应该跟着它 → away
    expect(m.home.name).toBe('飞鹰队');
    expect(m.away.name).toBe('猛虎队');
    expect(m.possession).toBe('away');

    // 再换回来
    m = applyCommand(m, 'sides.swap', {}, T0).match;
    expect(m.possession).toBe('home');
  });

  it('没有进攻权时换边不受影响', () => {
    let m = freshMatch();
    expect(m.possession).toBeNull();
    m = applyCommand(m, 'sides.swap', {}, T0).match;
    expect(m.possession).toBeNull();
  });

  it('置 FINAL 后节次标签变成 FINAL', () => {
    let m = freshMatch();
    m = applyCommand(m, 'match.final', {}, T0).match;
    expect(m.status).toBe('finished');
    expect(m.clock.periodLabel).toBe('FINAL');
  });

  it('结束后重新开打,节次标签要从 FINAL 恢复成当前节次', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.nextPeriod', {}, T0).match;
    expect(m.clock.period).toBe(2);
    expect(m.clock.periodLabel).toBe('Q2');

    m = applyCommand(m, 'match.final', {}, T0).match;
    expect(m.clock.periodLabel).toBe('FINAL');

    // 计分员误按「比赛结束」、随后改回「进行中」:标签必须跟着状态走,
    // 否则大屏会在 Q2 走表时仍写着 FINAL。
    m = applyCommand(m, 'match.status', { status: 'live' }, T0).match;
    expect(m.status).toBe('live');
    expect(m.clock.periodLabel).toBe('Q2');
  });

  it('结束后按「开始」,节次标签同样恢复', () => {
    let m = freshMatch();
    m = applyCommand(m, 'match.final', {}, T0).match;
    m = applyCommand(m, 'clock.start', {}, T0).match;
    expect(m.status).toBe('live');
    expect(m.clock.periodLabel).toBe('Q1');
  });

  it('match.update 只能改配置,改不了比分和时钟', () => {
    let m = freshMatch();
    const res = applyCommand(
      m,
      'match.update',
      { patch: { name: '改名后的场次', home: { ...m.home, score: 99 } } },
      T0,
    );
    expect(res.match.name).toBe('改名后的场次');
    expect(res.match.home.score).toBe(0);
  });
});

/*
 * 命令拒绝(rejectReason)。
 *
 * 归约层对"做不了"的命令是"照常返回一份状态、什么都不改",
 * 所以上层必须另外问一句"这条到底做不做得到" ——
 * 否则界面只能弹一个假的"已生效",而现场其实什么都没发生。
 */
describe('命令拒绝', () => {
  it('暂停额度用完 → 拒绝,并给出原因', () => {
    let m = freshMatch({ rules: { timeoutsPerTeam: 1 } });
    // 先用掉唯一的一次额度
    m = applyCommand(m, 'timeout.request', { side: 'home' }, T0).match;
    m = applyCommand(m, 'timeout.end', {}, T0).match;

    expect(rejectReason(m, 'timeout.request', { side: 'home' })).toBe('暂停已用完');
    expect(rejectReason(m, 'timeout.add', { side: 'home' })).toBe('暂停已用完');
  });

  it('已经有暂停在进行 → 拒绝,不重复计时', () => {
    const m = freshMatch();
    const running = applyCommand(m, 'timeout.request', { side: 'home' }, T0).match;
    expect(rejectReason(running, 'timeout.request', { side: 'away' })).toBe('暂停进行中');
  });

  it('额度还在、也没有暂停在进行 → 放行', () => {
    const m = freshMatch();
    expect(rejectReason(m, 'timeout.request', { side: 'home' })).toBeNull();
    expect(rejectReason(m, 'timeout.add', { side: 'away' })).toBeNull();
  });

  it('别的队的额度用完不影响这一队', () => {
    let m = freshMatch({ rules: { timeoutsPerTeam: 1 } });
    m = applyCommand(m, 'timeout.request', { side: 'home' }, T0).match;
    m = applyCommand(m, 'timeout.end', {}, T0).match;

    expect(rejectReason(m, 'timeout.request', { side: 'home' })).toBe('暂停已用完');
    expect(rejectReason(m, 'timeout.request', { side: 'away' })).toBeNull();
  });

  it('其它命令一律放行(没有额外的拒绝理由)', () => {
    const m = freshMatch();
    expect(rejectReason(m, 'score.add', { side: 'home', points: 3 })).toBeNull();
    expect(rejectReason(m, 'clock.toggle', {})).toBeNull();
    expect(rejectReason(m, 'undo', {})).toBeNull();
  });
});

/*
 * 计划开赛时间。
 *
 * 存在比赛的一个可选字段上 —— 大屏在开赛前 3 分钟切到开赛倒计时。
 * 格式错了必须当场拒掉:脏数据会让大屏算出一个莫名其妙的倒计时。
 */
describe('计划开赛时间', () => {
  it('match.update 可以设置开赛时间', () => {
    const m = freshMatch();
    const res = applyCommand(m, 'match.update', { patch: { startTime: '19:00' } }, T0);
    expect(res.match.startTime).toBe('19:00');
  });

  it('传 null 表示清空(大屏不再显示开赛倒计时)', () => {
    let m = freshMatch();
    m = applyCommand(m, 'match.update', { patch: { startTime: '19:00' } }, T0).match;
    m = applyCommand(m, 'match.update', { patch: { startTime: null } }, T0).match;
    expect(m.startTime).toBeNull();
  });

  it('没带这个字段 → 保持原值(局部补丁不许把别的字段冲掉)', () => {
    let m = freshMatch();
    m = applyCommand(m, 'match.update', { patch: { startTime: '19:00' } }, T0).match;
    m = applyCommand(m, 'match.update', { patch: { name: '改名后的场次' } }, T0).match;
    expect(m.startTime).toBe('19:00');
    expect(m.name).toBe('改名后的场次');
  });

  it('格式不对 → 拒绝,并给出原因', () => {
    const m = freshMatch();
    expect(rejectReason(m, 'match.update', { patch: { startTime: '25:00' } })).toBe('开赛时间格式应为 HH:MM');
    expect(rejectReason(m, 'match.update', { patch: { startTime: '不是时间' } })).toBe('开赛时间格式应为 HH:MM');
  });

  it('合法格式或没带这个字段 → 放行', () => {
    const m = freshMatch();
    expect(rejectReason(m, 'match.update', { patch: { startTime: '19:00' } })).toBeNull();
    expect(rejectReason(m, 'match.update', { patch: { startTime: null } })).toBeNull();
    expect(rejectReason(m, 'match.update', { patch: { name: 'x' } })).toBeNull();
  });
});

/* ============================================================================
 * 进攻钟与比赛钟的联动
 *
 * 规则依据:进攻钟随球权走,比赛钟停它也停
 * (FIBA:The shot clock stops any time the game clock stops)。
 * ========================================================================== */

describe('进攻钟与比赛钟联动', () => {
  it('开球:比赛钟启动 → 进攻钟复位到 24 秒并一起开跑', () => {
    const m0 = freshMatch();
    expect(m0.status).toBe('scheduled');
    expect(m0.shotClock.running).toBe(false);
    expect(m0.shotClock.remainingMs).toBe(24_000);

    const m = applyCommand(m0, 'clock.start', {}, T0).match;
    expect(m.clock.running).toBe(true);
    expect(m.shotClock.running).toBe(true);
    expect(m.shotClock.remainingMs).toBe(24_000);
  });

  it('中途恢复:比赛钟重新启动 → 进攻钟跟着走,但剩余值不被重置', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    // 罚球/暂停之前,进攻钟被设成 12 秒
    m = applyCommand(m, 'shot.set', { ms: 12_000 }, T0 + 1000).match;
    m = applyCommand(m, 'clock.pause', {}, T0 + 2000).match;
    expect(m.shotClock.running).toBe(false);
    // 从设值到暂停又走了 1 秒,所以剩 11 秒 —— 不是 12
    expect(m.shotClock.remainingMs).toBe(11_000);

    m = applyCommand(m, 'clock.start', {}, T0 + 3000).match;
    expect(m.clock.running).toBe(true);
    expect(m.shotClock.running).toBe(true);
    // 关键:没有被打回 24 秒 —— 中途恢复是"接着走",不是"重新开始"
    expect(m.shotClock.remainingMs).toBe(11_000);
  });

  it('比赛钟暂停 → 进攻钟跟着暂停', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = applyCommand(m, 'clock.pause', {}, T0 + 1000).match;
    expect(m.clock.running).toBe(false);
    expect(m.shotClock.running).toBe(false);
  });

  it('进攻钟归零后再按开始 → 复位到 24 秒(不会从 0 跑成死循环)', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = applyCommand(m, 'shot.set', { ms: 0 }, T0 + 1000).match;
    m = applyCommand(m, 'clock.pause', {}, T0 + 2000).match;

    m = applyCommand(m, 'clock.start', {}, T0 + 3000).match;
    expect(m.shotClock.remainingMs).toBe(24_000);
    expect(m.shotClock.running).toBe(true);
  });

  it('换节 = 跳球开球:进攻钟复位到 24 秒(停着),按开始后两个钟一起走', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = applyCommand(m, 'shot.set', { ms: 8_000 }, T0 + 1000).match;

    m = applyCommand(m, 'clock.nextPeriod', {}, T0 + 2000).match;
    expect(m.shotClock.remainingMs).toBe(24_000);
    expect(m.shotClock.running).toBe(false);

    m = applyCommand(m, 'clock.start', {}, T0 + 3000).match;
    expect(m.shotClock.running).toBe(true);
    expect(m.shotClock.remainingMs).toBe(24_000);
  });

  it('进攻钟本来就在跑时,比赛钟启动不会重设它的锚点(表不跳)', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = applyCommand(m, 'shot.set', { ms: 20_000 }, T0 + 1000).match;
    const before = m.shotClock.anchorServerTs;

    m = applyCommand(m, 'clock.start', {}, T0 + 2000).match;
    expect(m.shotClock.anchorServerTs).toBe(before);
    expect(m.shotClock.remainingMs).toBe(20_000);
  });
});

/* ============================================================================
 * 进攻钟的命令
 * ========================================================================== */

describe('进攻钟命令', () => {
  it('重置(不带 start)= 复位但停着', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = applyCommand(m, 'shot.set', { ms: 5_000 }, T0 + 1000).match;

    m = applyCommand(m, 'shot.reset', { seconds: 24 }, T0 + 2000).match;
    expect(m.shotClock.remainingMs).toBe(24_000);
    expect(m.shotClock.running).toBe(false);
  });

  it('重置并开表(start: true)= 复位后直接跑起来(投篮命中最常用)', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = applyCommand(m, 'shot.set', { ms: 5_000 }, T0 + 1000).match;

    m = applyCommand(m, 'shot.reset', { seconds: 24, start: true }, T0 + 2000).match;
    expect(m.shotClock.remainingMs).toBe(24_000);
    expect(m.shotClock.running).toBe(true);
  });

  it('14 秒:抢到进攻篮板后复位到 14 并开表', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;

    m = applyCommand(m, 'shot.reset', { seconds: 14, start: true }, T0 + 1000).match;
    expect(m.shotClock.remainingMs).toBe(14_000);
    expect(m.shotClock.running).toBe(true);
  });

  it('24 秒违例:球权转给对方 + 进攻钟复位 24 + 比赛钟停住', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = applyCommand(m, 'possession.set', { side: 'home' }, T0 + 1000).match;
    m = applyCommand(m, 'shot.set', { ms: 0 }, T0 + 2000).match;

    const r = applyCommand(m, 'shot.violation', {}, T0 + 3000);
    expect(r.match.possession).toBe('away');
    expect(r.match.shotClock.remainingMs).toBe(24_000);
    expect(r.match.shotClock.running).toBe(false);
    expect(r.match.clock.running).toBe(false);
    expect(r.log).toContain('24 秒违例');
  });

  it('进攻权本来就是空的时候不擅自给球权,只复位进攻钟', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    expect(m.possession).toBeNull();

    const r = applyCommand(m, 'shot.violation', {}, T0 + 1000);
    expect(r.match.possession).toBeNull();
    expect(r.match.shotClock.remainingMs).toBe(24_000);
  });

  it('违例之后按开始比赛 → 两个钟一起走,进攻钟是满的 24 秒', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = applyCommand(m, 'possession.set', { side: 'home' }, T0 + 1000).match;
    m = applyCommand(m, 'shot.violation', {}, T0 + 2000).match;

    m = applyCommand(m, 'clock.start', {}, T0 + 3000).match;
    expect(m.clock.running).toBe(true);
    expect(m.shotClock.running).toBe(true);
    expect(m.shotClock.remainingMs).toBe(24_000);
  });
});
