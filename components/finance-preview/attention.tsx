"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CircleCheck,
  CloudOff,
  Copy,
  Landmark,
  Link2,
  ClipboardCheck,
  TriangleAlert,
  Undo2,
  CircleDashed,
  type LucideIcon,
} from "lucide-react";
import { ageLabel } from "@/lib/finance-preview/format";
import { DEMO_TODAY } from "@/lib/finance-preview/fixtures";
import {
  ATTENTION_GROUP_LABEL,
  type AttentionGroup,
  type AttentionItem,
} from "@/lib/finance-preview/selectors";
import { usePreview } from "./context";
import { EmptyState, MoneyAmount, ProposalPill, StatusBadge } from "./ui";

const GROUP_ICON: Record<AttentionGroup, LucideIcon> = {
  integration: CloudOff,
  records: TriangleAlert,
  duplicate: Copy,
  link: Link2,
  difference: TriangleAlert,
  refund: Undo2,
  deposit: Landmark,
  approve: ClipboardCheck,
};

const PROPOSAL_GROUPS: AttentionGroup[] = ["duplicate", "link", "difference", "refund", "deposit"];

function Item({ item, compact, onResolve }: { item: AttentionItem; compact?: boolean; onResolve: (i: AttentionItem) => void }) {
  const Icon = item.title.startsWith("Culto sin registros") ? CircleDashed : GROUP_ICON[item.group];
  const tone = item.tone === "neutral" ? "neutral" : item.tone;
  return (
    <li className="fx-att-item">
      <span className={`fx-att-icon fx-tone-${tone}`} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div style={{ minWidth: 0 }}>
        <p className="fx-att-title">{item.title}</p>
        <p className="fx-att-meta">
          {compact ? `${ATTENTION_GROUP_LABEL[item.group]} · ` : ""}
          {item.detail}
          {compact && item.proposal ? " · Propuesta" : ""}
        </p>
        {compact && (item.amount !== undefined || item.overdue) && (
          <p className="fx-att-meta" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            {item.amount !== undefined && (
              <span className="fx-att-amount" style={{ color: "var(--fx-ink)" }}>
                <MoneyAmount value={item.amount} diff={item.group === "difference"} />
              </span>
            )}
            {item.overdue && <StatusBadge status="overdue" detail={`${item.ageDays} d`} />}
          </p>
        )}
      </div>
      <div className="fx-att-side">
        {!compact && item.amount !== undefined && (
          <span className="fx-att-amount">
            <MoneyAmount value={item.amount} diff={item.group === "difference"} />
          </span>
        )}
        {compact ? null : item.overdue ? (
          <StatusBadge status="overdue" detail={`${item.ageDays} d`} />
        ) : (
          item.date && <span className="fx-help">{ageLabel(item.date, DEMO_TODAY)}</span>
        )}
        <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => onResolve(item)}>
          {item.cta}
        </button>
      </div>
    </li>
  );
}

export function AttentionList({
  items,
  compact,
  max,
}: {
  items: AttentionItem[];
  compact?: boolean;
  max?: number;
}) {
  const { simulate } = usePreview();
  const [resolved, setResolved] = useState<string[]>([]);
  const visible = items.filter((i) => !resolved.includes(i.id));
  const shown = max ? visible.slice(0, max) : visible;

  const resolve = (i: AttentionItem) => {
    setResolved((r) => [...r, i.id]);
    simulate(`${i.cta}: ${i.title}`, () => setResolved((r) => r.filter((x) => x !== i.id)));
  };

  if (!visible.length)
    return <EmptyState icon={CircleCheck} title="Todo al día" body="No hay nada que necesite tu atención." />;

  if (compact)
    return (
      <>
        <ul className="fx-att-compact">
          {shown.map((i) => (
            <Item key={i.id} item={i} compact onResolve={resolve} />
          ))}
        </ul>
        {visible.length > shown.length && (
          <Link className="fx-link" href="/preview/finanzas-2026/atencion" style={{ marginTop: 8 }}>
            Ver los {visible.length} pendientes <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </>
    );

  const groups = [...new Set(visible.map((i) => i.group))];
  return (
    <div>
      {groups.map((g) => {
        const list = visible.filter((i) => i.group === g);
        return (
          <section className="fx-att-group" key={g} aria-labelledby={`att-${g}`}>
            <h2 className="fx-att-group-head" id={`att-${g}`}>
              {ATTENTION_GROUP_LABEL[g]} <span className="fx-count">({list.length})</span>
              {PROPOSAL_GROUPS.includes(g) && <ProposalPill />}
            </h2>
            <ul>
              {list.map((i) => (
                <Item key={i.id} item={i} onResolve={resolve} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
