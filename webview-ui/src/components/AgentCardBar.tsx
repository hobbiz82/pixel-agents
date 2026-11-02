import { useState } from 'react';

import {
  CARD_BAR_EXPANDED_STORAGE_KEY,
  CARD_BAR_EXPANDED_WIDTH_PX,
  TERMINAL_SIDEBAR_WIDTH_PX,
} from '../constants.js';
import { useNow } from '../hooks/useNow.js';
import type { SessionRow } from '../office/sessionRows.js';
import type { AgentAppearance, TabStatus } from './AgentCard.js';
import { AgentCard } from './AgentCard.js';
import { cardVariant } from './cardBar.js';
import { Button } from './ui/Button.js';

interface AgentCardBarProps {
  /** Agents to show, top to bottom. */
  agentIds: number[];
  /** The agent whose terminal pane is showing (standalone). Its card gets the
   *  accent border. */
  activeAgentId?: number | null;
  /** The agent whose character is selected in the office. Its card gets the
   *  active background; `activeAgentId` wins when both name the same agent. */
  focusedAgentId?: number | null;
  getAppearance: (agentId: number) => AgentAppearance;
  statusFor: (agentId: number) => TabStatus | null;
  onSelect: (agentId: number) => void;
  onClose: (agentId: number) => void;
  /** mptl fork: session name / tool / idle for each card. When given, the bar
   *  gets a toggle that widens it to show this beside the mug shots. */
  infoFor?: (agentId: number, now: number) => SessionRow | undefined;
  /** mptl fork: Lưu trữ on each card; absent in a read-only office. */
  onArchive?: (agentId: number) => void;
}

/** Saved expand choice; defaults to expanded. Storage may be blocked. */
function readExpanded(): boolean {
  try {
    return localStorage.getItem(CARD_BAR_EXPANDED_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function saveExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(CARD_BAR_EXPANDED_STORAGE_KEY, expanded ? '1' : '0');
  } catch {
    // private window / blocked storage: the choice just isn't remembered
  }
}

/**
 * The column of agent cards along the office's right edge — one mug shot and
 * status dot per agent — shared by both desktop hosts.
 *
 * Transparent and borderless, drawn on top of the office space: the negative
 * margin exactly cancels the column's width, so it takes no layout room and
 * overlays the office's right edge as a flex sibling of the office region.
 * Pointer events pass through the empty parts so the office stays clickable
 * underneath; only the cards are interactive.
 *
 * In standalone, TerminalDrawer owns the bar and the cards double as the
 * terminal panel's tabs (the panel opens to the bar's right). In VS Code the
 * bar stands alone and lists every agent in the office, external sessions
 * included; a card click raises that agent's editor terminal via focusAgent.
 */
export function AgentCardBar({
  agentIds,
  activeAgentId = null,
  focusedAgentId = null,
  getAppearance,
  statusFor,
  onSelect,
  onClose,
  infoFor,
  onArchive,
}: AgentCardBarProps) {
  const [expanded, setExpanded] = useState(readExpanded);
  const showInfo = infoFor !== undefined && expanded;
  const now = useNow(showInfo);

  if (agentIds.length === 0) return null;

  const width = showInfo ? CARD_BAR_EXPANDED_WIDTH_PX : TERMINAL_SIDEBAR_WIDTH_PX;

  return (
    <div
      className={`relative z-30 h-full shrink-0 flex flex-col gap-4 pt-4 overflow-y-auto pointer-events-none ${showInfo ? 'items-stretch px-4' : 'items-center'}`}
      style={{ width, marginLeft: -width }}
    >
      {infoFor && (
        <Button
          variant="ghost"
          size="sm"
          className="pointer-events-auto self-end shrink-0"
          title={expanded ? 'Ẩn tên phiên' : 'Hiện tên phiên'}
          data-testid="card-bar-toggle"
          onClick={() => {
            setExpanded(!expanded);
            saveExpanded(!expanded);
          }}
        >
          {expanded ? '»' : '«'}
        </Button>
      )}
      {agentIds.map((agentId) => (
        <AgentCard
          key={agentId}
          agentId={agentId}
          variant={cardVariant(agentId, { activeId: activeAgentId, focusedId: focusedAgentId })}
          appearance={getAppearance(agentId)}
          status={statusFor(agentId)}
          onSelect={onSelect}
          onClose={onClose}
          info={showInfo ? infoFor(agentId, now) : undefined}
          onArchive={onArchive}
          archiveBlock={onArchive && infoFor ? (infoFor(agentId, now)?.archiveBlock ?? null) : null}
        />
      ))}
    </div>
  );
}
