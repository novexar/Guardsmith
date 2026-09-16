// gen: 参照テンプレート(Tremor 風 KPI カード)。実 PJ では Tremor のコピペ方式で
// KPI カード・スパークライン等を取り込み、この命名(kpi-card.tsx)に合わせる。
// 数値は tabular-nums、区切りは hairline border(DESIGN.md)。
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface KpiCardProps {
  label: string;
  value: string;
  /** ステータス色のみ意味を持つ(success / warning / danger)。省略時はニュートラル */
  status?: "success" | "warning" | "danger";
}

const statusClass = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
} as const;

export function KpiCard({ label, value, status }: KpiCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-3xl font-semibold tabular-nums ${status ? statusClass[status] : ""}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
