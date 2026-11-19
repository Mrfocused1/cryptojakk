// House rules + match options: the editor (host / solo setup), the read-only view (guests) and the compact chip summary.
import { useState } from 'react';
import { HANDS_TO_WIN_OPTIONS, type HouseRules, type MatchOptions, TURN_SECONDS_OPTIONS } from '@shared/engine';
import { HANDS_LABEL, HOUSE_RULE_INFO, ruleChips, timerLabel } from './describe';
import { Icon, Sheet } from './components';

interface SegProps<T extends number> {
  label: string;
  hint: string;
  value: T;
  values: readonly T[];
  fmt: (v: T) => string;
  editable: boolean;
  onPick: (v: T) => void;
  testid: string;
}

function Seg<T extends number>({ label, hint, value, values, fmt, editable, onPick, testid }: SegProps<T>) {
  return (
    <div className="opt-block" data-testid={testid}>
      <div className="opt-head">
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <div className={`opt-seg ${editable ? '' : 'ro'}`} role="radiogroup" aria-label={label}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            disabled={!editable}
            className={`opt-seg-b ${value === v ? 'on' : ''}`}
            data-value={v}
            onClick={() => onPick(v)}
          >
            {fmt(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface OptionsEditorProps {
  houseRules: HouseRules;
  options: MatchOptions;
  /** Host (or solo player): switches work. Guests see the same list read-only. */
  editable: boolean;
  onHouseRules: (patch: Partial<HouseRules>) => void;
  onOptions: (patch: Partial<MatchOptions>) => void;
  /** Solo games never run a turn timer. */
  showTimer?: boolean;
}

export function OptionsEditor({ houseRules, options, editable, onHouseRules, onOptions, showTimer = true }: OptionsEditorProps) {
  return (
    <div className={`opts ${showTimer ? '' : 'solo'}`} data-testid="options" data-editable={editable ? 'true' : 'false'}>
      <Seg
        label="Hands to win"
        hint={options.handsToWin === 1 ? 'One hand decides the match.' : `First to win ${options.handsToWin} hands wins the match.`}
        value={options.handsToWin}
        values={HANDS_TO_WIN_OPTIONS}
        fmt={(v) => String(v)}
        editable={editable}
        onPick={(v) => onOptions({ handsToWin: v })}
        testid="opt-hands"
      />
      {showTimer && (
        <Seg
          label="Turn timer"
          hint={options.turnSeconds === 0 ? 'No time limit.' : `${options.turnSeconds} seconds a turn, then the default move is played (take the pickup, else draw).`}
          value={options.turnSeconds}
          values={TURN_SECONDS_OPTIONS}
          fmt={timerLabel}
          editable={editable}
          onPick={(v) => onOptions({ turnSeconds: v })}
          testid="opt-timer"
        />
      )}
      <h3 className="opt-sub">House rules</h3>
      <ul className="opt-list">
        {HOUSE_RULE_INFO.map((r) => (
          <li key={r.key}>
            <label className={`opt-toggle ${editable ? '' : 'ro'}`}>
              <span className="opt-t">
                <strong>{r.title}</strong>
                <small>{r.hint}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={houseRules[r.key]}
                disabled={!editable}
                onChange={(e) => onHouseRules({ [r.key]: e.target.checked })}
                data-testid={`rule-${r.key}`}
                aria-label={r.title}
              />
              <i className="switch" aria-hidden="true" />
            </label>
          </li>
        ))}
      </ul>
      {!editable && <p className="opt-note">Only the host can change these.</p>}
    </div>
  );
}

/** What is switched on, in full sentences (the expanded chip row / the in-game sheet). */
export function RulesList({ houseRules, options }: { houseRules: HouseRules; options: MatchOptions }) {
  return (
    <ul className="rules-full" data-testid="rules-full">
      <li>
        <b>{HANDS_LABEL[options.handsToWin]}.</b> {options.handsToWin === 1 ? 'The first hand decides the match.' : `Win ${options.handsToWin} hands to win the match.`}
      </li>
      <li>
        <b>Turn timer: {timerLabel(options.turnSeconds)}.</b> {options.turnSeconds === 0 ? 'Take as long as you like.' : `${options.turnSeconds} seconds a turn. When it runs out you take the pickup, or draw one.`}
      </li>
      {HOUSE_RULE_INFO.map((r) => (
        <li key={r.key} className={houseRules[r.key] ? 'on' : 'off'}>
          <b>{r.title}: {houseRules[r.key] ? 'on' : 'off'}.</b> {houseRules[r.key] ? r.on : r.off}
        </li>
      ))}
    </ul>
  );
}

/** Compact summary of the active rules. `sheet`: tapping opens a dialog (table). `inline`: it expands in place (lobby). */
export function RulesChips({ houseRules, options, mode = 'inline', className = '' }: { houseRules: HouseRules; options: MatchOptions; mode?: 'inline' | 'sheet'; className?: string }) {
  const [open, setOpen] = useState(false);
  const chips = ruleChips(houseRules, options);
  return (
    <div className={`rules-chips ${className}`} data-testid="rules-chips">
      <button type="button" className="rc-row" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="rules-chips-btn">
        <span className="rc-cap">House rules</span>
        <span className="rc-scroll">
          {chips.map((c) => (
            <i key={c.key} className={`rc ${c.on ? 'on' : ''}`}>
              {c.label}
            </i>
          ))}
        </span>
        <Icon name="down" className={`rc-chev ${open && mode === 'inline' ? 'up' : ''}`} />
      </button>
      {mode === 'inline' && open && <RulesList houseRules={houseRules} options={options} />}
      {mode === 'sheet' && (
        <Sheet open={open} onClose={() => setOpen(false)} title="House rules in this game">
          <RulesList houseRules={houseRules} options={options} />
        </Sheet>
      )}
    </div>
  );
}
