import { useEffect, useRef, useState } from 'react';

import {
  CARD_BAR_EXPANDED_STORAGE_KEY,
  CARD_BAR_EXPANDED_WIDTH_PX,
  TERMINAL_SIDEBAR_WIDTH_PX,
} from '../constants.js';
import { useNow } from '../hooks/useNow.js';
import { browserStorage } from '../hooks/useProjectOffice.js';
import {
  CARD_SORTS,
  cardQueryActive,
  loadCardQuery,
  saveCardQuery,
  visibleCardIds,
} from '../office/cardBarQuery.js';
import type { SessionRow } from '../office/sessionRows.js';
import { DEFAULT_QUERY, type TableQuery } from '../office/sessionTable.js';
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
  /** mptl fork (Đ2.1): the character anh right-clicked — scrolled into view,
   *  bright border, kept visible whatever the filter. */
  highlightId?: number | null;
}

const SELECT_CLASS = 'min-w-0 px-2 py-1 bg-btn-bg border-2 border-border text-text text-xs';

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
  highlightId = null,
}: AgentCardBarProps) {
  const [expanded, setExpanded] = useState(readExpanded);
  const showInfo = infoFor !== undefined && expanded;
  const now = useNow(showInfo);
  const [query, setQueryState] = useState<TableQuery>(() => loadCardQuery(browserStorage()));
  const setQuery = (patch: Partial<TableQuery>) => {
    const next = { ...query, ...patch };
    setQueryState(next);
    saveCardQuery(browserStorage(), next);
  };
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightId === null) return;
    barRef.current
      ?.querySelector(`[data-agent-id="${highlightId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightId]);

  if (agentIds.length === 0) return null;

  // The query only applies while names show; the collapsed bar lists everyone.
  const shownIds =
    showInfo && infoFor
      ? visibleCardIds(agentIds, (id) => infoFor(id, now), query, highlightId)
      : agentIds;
  const sortValue = CARD_SORTS.findIndex((o) => o.value === query.sort);

  const width = showInfo ? CARD_BAR_EXPANDED_WIDTH_PX : TERMINAL_SIDEBAR_WIDTH_PX;

  return (
    <div
      ref={barRef}
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
      {showInfo && (
        <div
          className="pointer-events-auto shrink-0 flex flex-col gap-2 p-2 bg-bg border-2 border-border"
          data-testid="card-bar-query"
        >
          <input
            type="search"
            value={query.search}
            onChange={(e) => setQuery({ search: e.target.value })}
            placeholder="Tìm tên, project…"
            aria-label="Tìm phiên"
            className="px-2 py-1 bg-btn-bg border-2 border-border text-text text-xs"
            data-testid="card-bar-search"
          />
          <div className="grid grid-cols-3 gap-2">
            <select
              value={query.providers[0] ?? ''}
              onChange={(e) =>
                setQuery({
                  providers: e.target.value ? [e.target.value as 'claude' | 'codex'] : [],
                })
              }
              aria-label="Công cụ"
              className={SELECT_CLASS}
              data-testid="card-bar-tool"
            >
              <option value="">Công cụ</option>
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
            <select
              value={query.statuses[0] ?? ''}
              onChange={(e) =>
                setQuery({
                  statuses: e.target.value
                    ? [e.target.value as TableQuery['statuses'][number]]
                    : [],
                })
              }
              aria-label="Trạng thái"
              className={SELECT_CLASS}
              data-testid="card-bar-status"
            >
              <option value="">Trạng thái</option>
              <option value="waiting">Chờ anh</option>
              <option value="busy">Đang chạy</option>
              <option value="idle">Rảnh</option>
            </select>
            <select
              value={sortValue < 0 ? 0 : sortValue}
              onChange={(e) => {
                const o = CARD_SORTS[Number(e.target.value)];
                setQuery({ sort: o.value, dir: o.dir });
              }}
              aria-label="Sắp xếp"
              className={SELECT_CLASS}
              data-testid="card-bar-sort"
            >
              {CARD_SORTS.map((o, i) => (
                <option key={o.value} value={i}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {cardQueryActive(query) && (
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span data-testid="card-bar-count">
                {shownIds.length}/{agentIds.length} phiên
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQueryState(DEFAULT_QUERY);
                  saveCardQuery(browserStorage(), DEFAULT_QUERY);
                }}
                data-testid="card-bar-clear"
              >
                Bỏ lọc
              </Button>
            </div>
          )}
        </div>
      )}
      {shownIds.map((agentId) => (
        <AgentCard
          key={agentId}
          highlighted={agentId === highlightId}
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
