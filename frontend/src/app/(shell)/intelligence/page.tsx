import Card, { PageTitle } from "@/components/Card";

export default function IntelligencePage() {
  return (
    <>
      <PageTitle title="Intelligence" desc="Phân tích và hỗ trợ ra quyết định từ dữ liệu IoT và quy trình." />
      <Card title="Chưa có dữ liệu">
        <p className="text-sm text-slate-600">
          Màn hình này sẽ hiển thị chỉ số từ dữ liệu cảm biến (<code className="rounded bg-slate-100 px-1">backend/simulate-iot.js</code>)
          khi pipeline dữ liệu được xây dựng.
        </p>
      </Card>
    </>
  );
}
