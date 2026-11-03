/**
 * 足球面板:补时 + 半场/中场休息。
 * ------------------------------------------------------------------
 * 篮球的控件(进攻钟、犯规、暂停)在足球里一个都用不上,这一块是足球专属的。
 *
 * 球场上的实际流程:
 *
 *   上半场 00:00 → 45:00     主钟往上走,到点自动停表
 *        ↓ 裁判宣布"补时 4 分钟"
 *   补时表 +04:00            独立的一个表,归零后自动进中场休息
 *        ↓
 *   中场休息 15:00           倒计时,**归零绝不自动开始下半场**
 *        ↓ 计分员按「结束中场休息」
 *   下半场 00:00 → 45:00
 *
 * 三条规矩贯穿整个面板:
 *   1. 归零不自动开表 —— 什么时候开打由计分员按;
 *   2. 补时走独立的表 —— 主钟停在 45:00 不动,补时表单独走;
 *   3. 破坏性的动作(回到上半场)要二次确认。
 */
import { useState } from 'react';
import type { FootballPhase } from '@biph/shared';
import { useI18n } from '../i18n';
import { formatClock } from '../lib/format';
import { ConfirmButton } from './ConfirmButton';
import { SevenSegment } from './SevenSegment';
import { IconPause, IconPlay } from './icons';

/** 常用补时(分钟)—— 裁判最常宣布的几个数 */
export const ADDED_TIME_PRESETS = [1, 2, 4, 5];

export interface FootballPanelProps {
  /** 当前阶段:上半场 / 中场休息 / 下半场 */
  phase: FootballPhase;
  /** 补时剩余毫秒(0 = 没设补时) */
  addedTimeMs: number;
  /** 补时是否在走 */
  addedTimeRunning: boolean;
  /** 补时总时长(ms) —— 用来显示 "+04:00" 里的那个 04 */
  addedTimeDurationMs: number;
  /** 中场倒计时剩余毫秒 */
  halftimeMs: number;
  /** 中场倒计时是否在走 */
  halftimeRunning: boolean;
  /** 中场休息时长(分钟) */
  halftimeMinutes: number;
  /** 结束上半场:主钟停表并停在 45:00 */
  onHalfEnd: () => void;
  /** 设补时(seconds)。start=true 表示设完直接开表 */
  onAddedTimeSet: (seconds: number, start: boolean) => void;
  /** 补时开/停 */
  onAddedTimeToggle: () => void;
  /** 开始中场休息(第一次按 = 进入中场并开倒计时) */
  onHalftimeStart: () => void;
  /** 中场倒计时暂停/继续 */
  onHalftimeToggle: () => void;
  /** 结束中场休息 → 进入下半场 */
  onHalftimeEnd: () => void;
  /** 回到上半场(点错了时的退路,破坏性) */
  onBackToFirstHalf?: () => void;
  disabled?: boolean;
}

export function FootballPanel({
  phase,
  addedTimeMs,
  addedTimeRunning,
  addedTimeDurationMs,
  halftimeMs,
  halftimeRunning,
  halftimeMinutes,
  onHalfEnd,
  onAddedTimeSet,
  onAddedTimeToggle,
  onHalftimeStart,
  onHalftimeToggle,
  onHalftimeEnd,
  onBackToFirstHalf,
  disabled = false,
}: FootballPanelProps) {
  const { t } = useI18n();
  const [customMinutes, setCustomMinutes] = useState('');

  const hasAddedTime = addedTimeDurationMs > 0;
  const inHalftime = phase === 'halftime';
  const inSecondHalf = phase === 'second';

  /** 自定义补时分钟数:只认正整数,其它一律当作"没填" */
  const customValue = Number(customMinutes.trim());
  const customValid = Number.isFinite(customValue) && customValue > 0 && customValue <= 30;

  return (
    <div className="clock-panel football-panel">
      <div className="panel-label">{t('football.label')}</div>

      {/* ------------------------------ 补时 ------------------------------ */}
      <div className="fb-block">
        <div className="fb-head">
          <span className="fb-head-label">{t('football.addedTime')}</span>
          {hasAddedTime ? (
            <span className="fb-added">
              <span className="fb-sign">+</span>
              <SevenSegment
                value={formatClock(addedTimeMs)}
                height={34}
                color={addedTimeRunning ? '#ffb020' : '#9aa6c0'}
                dimColor="rgba(255,255,255,0.07)"
                title={t('football.addedTime.title', { time: formatClock(addedTimeMs) })}
              />
            </span>
          ) : null}
        </div>

        <div className="step-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {ADDED_TIME_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className="step-btn plus"
              disabled={disabled}
              onClick={() => onAddedTimeSet(m * 60, false)}
              title={t('football.addedTime.set.title', { n: m })}
            >
              +{m}
            </button>
          ))}
        </div>

        <div className="fb-custom">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            value={customMinutes}
            placeholder={t('football.addedTime.custom')}
            disabled={disabled}
            onChange={(e) => setCustomMinutes(e.target.value)}
            aria-label={t('football.addedTime.custom')}
          />
          <button
            type="button"
            className="btn"
            disabled={disabled || !customValid}
            onClick={() => {
              if (!customValid) return;
              onAddedTimeSet(Math.round(customValue) * 60, false);
              setCustomMinutes('');
            }}
          >
            {t('football.addedTime.set')}
          </button>
        </div>

        <div className="clock-sub-row">
          <button
            type="button"
            className={addedTimeRunning ? 'btn' : 'btn primary'}
            disabled={disabled || !hasAddedTime}
            onClick={onAddedTimeToggle}
            title={t('football.addedTime.toggle.title')}
          >
            {addedTimeRunning ? <IconPause size={18} /> : <IconPlay size={18} />}
            {addedTimeRunning ? t('football.addedTime.pause') : t('football.addedTime.start')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={disabled || !hasAddedTime}
            onClick={() => onAddedTimeSet(0, false)}
          >
            {t('football.addedTime.clear')}
          </button>
        </div>
      </div>

      {/* --------------------------- 半场 / 中场 --------------------------- */}
      <div className="fb-block">
        <div className="fb-head">
          <span className="fb-head-label">{t('football.half.label')}</span>
          <span className="fb-half">
            {inHalftime
              ? t('football.half.halftime')
              : inSecondHalf
                ? t('football.half.second')
                : t('football.half.first')}
          </span>
        </div>

        {inHalftime ? (
          <>
            <div className="seg-wrap">
              <SevenSegment
                value={formatClock(halftimeMs)}
                height={52}
                color={halftimeRunning ? '#ffb020' : '#9aa6c0'}
                dimColor="rgba(255,255,255,0.07)"
                title={t('football.halftime.title', { time: formatClock(halftimeMs) })}
              />
            </div>
            <div className="clock-sub-row">
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={onHalftimeToggle}
                title={t('football.halftime.toggle.title')}
              >
                {halftimeRunning ? <IconPause size={18} /> : <IconPlay size={18} />}
                {halftimeRunning ? t('football.halftime.pause') : t('football.halftime.resume')}
              </button>
              <button type="button" className="btn primary" disabled={disabled} onClick={onHalftimeEnd}>
                {t('football.halftime.end')}
              </button>
            </div>
          </>
        ) : (
          <div className="clock-sub-row">
            {inSecondHalf ? null : (
              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={onHalfEnd}
                title={t('football.halfEnd.title')}
              >
                {t('football.halfEnd')}
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={disabled}
              onClick={onHalftimeStart}
              title={t('football.halftime.start.title', { n: halftimeMinutes })}
            >
              {t('football.halftime.start', { n: halftimeMinutes })}
            </button>
          </div>
        )}

        {/* 退路:下半场的场次点错了,回到上半场(破坏性,二次确认) */}
        {inSecondHalf && onBackToFirstHalf ? (
          <div className="clock-sub-row">
            <ConfirmButton
              label={t('football.backToFirst')}
              variant="danger"
              disabled={disabled}
              onConfirm={onBackToFirstHalf}
              title={t('football.backToFirst.title')}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default FootballPanel;
