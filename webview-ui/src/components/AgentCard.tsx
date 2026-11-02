import { LONG_IDLE_COLOR } from '../constants.js';
import type { SessionRow } from '../office/sessionRows.js';
import type { CardVariant } from './cardBar.js';
import { CharacterMugShot } from './CharacterMugShot.js';
import { Button } from './ui/Button.js';

/** How a given agent's character looks, for the tab mug shot. */
export interface AgentAppearance {
  palette: number;
  hueShift: number;
}

/** Agent activity reflected by the tab's status dot. */
export type AgentActivity = 'idle' | 'working' | 'attention';

/** Activity plus the drawer-owned "connection broken" state. */
export type TabStatus = AgentActivity | 'disconnected';

const STATUS_DOT: Record<TabStatus, string> = {
  idle: 'bg-status-success', // green — turn complete, nothing pending
  working: 'bg-accent-bright', // blue — actively running
  attention: 'bg-status-permission', // yellow — needs permission or input
  disconnected: 'bg-status-error', // red — terminal socket dropped
};

const CARD_VARIANT: Record<CardVariant, string> = {
  default: 'bg-btn-bg border-transparent hover:bg-btn-hover',
  focused: 'bg-active-bg border-transparent',
  active: 'bg-active-bg border-accent',
};

interface AgentCardProps {
  agentId: number;
  variant: CardVariant;
  appearance: AgentAppearance;
  status: TabStatus | null;
  /** When false the × is invisible (not removed — the card keeps its width so
   *  the bar doesn't reflow). Mobile only shows it on the active terminal tab
   *  to keep a stray tap from killing an agent. */
  showClose?: boolean;
  onSelect: (agentId: number) => void;
  onClose: (agentId: number) => void;
  /** mptl fork: session name, tool and idle time beside the mug shot. */
  info?: SessionRow;
}

/** Hover text: full session name, folder, then status · RAM. */
function cardTitle(agentId: number, info: SessionRow | undefined): string {
  if (!info) return `Agent ${agentId}`;
  const detail = [info.statusText, info.ramText && `RAM ${info.ramText}`]
    .filter(Boolean)
    .join(' · ');
  return [info.name, info.folder && `Thư mục: ${info.folder}`, detail].filter(Boolean).join('\n');
}

/** One agent's card in the terminal sidebar — mug shot beside a
 *  close-button/status-dot column. The cards double as the terminal panel's
 *  tabs: clicking one selects that agent's pane. */
export function AgentCard({
  agentId,
  variant,
  appearance,
  status,
  showClose = true,
  onSelect,
  onClose,
  info,
}: AgentCardProps) {
  return (
    <div
      className={`pointer-events-auto flex items-stretch gap-1 p-1 cursor-pointer border-2 shrink-0 ${CARD_VARIANT[variant]}`}
      onClick={() => onSelect(agentId)}
      title={cardTitle(agentId, info)}
      data-testid="agent-card"
    >
      <CharacterMugShot palette={appearance.palette} hueShift={appearance.hueShift} />
      {info && (
        <div className="flex flex-col justify-center min-w-0 flex-1 leading-tight">
          <span className="text-sm text-text truncate" data-testid="agent-card-name">
            {info.name}
          </span>
          <span className="text-xs truncate">
            {info.provider && (
              <span style={{ color: info.provider.color }}>{info.provider.label}</span>
            )}
            {info.provider && info.statusText && <span className="text-text-muted"> · </span>}
            <span
              className={info.longIdle ? undefined : 'text-text-muted'}
              style={info.longIdle ? { color: LONG_IDLE_COLOR } : undefined}
            >
              {info.statusText}
            </span>
          </span>
        </div>
      )}
      {/* Close on top, status dot at the bottom, both centred over the
          same column beside the mug shot. */}
      <div className="flex flex-col items-center justify-between shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            // Don't also select the tab we're about to remove.
            e.stopPropagation();
            onClose(agentId);
          }}
          title="Close agent"
          className={`leading-none ${showClose ? '' : 'invisible'}`}
        >
          ×
        </Button>
        {/* 1px left: optically centres the solid square under the pixel-font ×
            glyph, which sits a hair left in its cell. mb (not pb) lifts it off
            the card's bottom edge: the span is a fixed-size empty box, so
            padding is invisible — only margin moves it. */}
        <span
          className={`size-6 shrink-0 relative -left-1 mb-2 ${status ? STATUS_DOT[status] : ''}`}
        />
      </div>
    </div>
  );
}
