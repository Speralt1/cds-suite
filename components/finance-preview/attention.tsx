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
  const age = item.overdue ? null : ageLabel(item.date, DEMO_TODAY);
  const amount = item.amount !== undefined && (
    <MoneyAmount value={item.amount} diff={item.group === "difference"} />
  );
  return (
    <li className="fx-att-item">
      <span className={`fx-att-icon fx-tone-${item.tone}`} aria-hidden="true">
        <Icon size={18} />
      </span>
      <div style={{ minWidth: 0 }}>
        <p className="fx-att-title">{item.title}</p>
        <p className="fx-att-meta">
          {compact ? `${ATTENTION_GROUP_LABEL[item.group]} · ` : ""}
          {item.detail}
          {age ? ` · ${age}` : ""}
          {compact && item.proposal ? " · Propuesta" : ""}
        </p>
      </div>
      {compact ? (
        <div className="fx-att-side">
          {amount && <span className="fx-att-amount">{amount}</span>}
          {item.overdue && <StatusBadge status="overdue" detail={`${item.ageDays} d`} />}
          <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => onResolve(item)}>
            {item.cta}
          </button>
        </div>
      ) : (
        <div className="fx-att-side">
          <span className="fx-att-amount fx-att-amount-col">{amount}</span>
          <span className="fx-att-age-col">
            {item.overdue && <StatusBadge status="overdue" detail={`${item.ageDays} d`} />}
          </span>
          <button type="button" className="fx-btn fx-btn-secondary fx-btn-sm" onClick={() => onResolve(item)}>
            {item.cta}
          </button>
        </div>
      )}
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
