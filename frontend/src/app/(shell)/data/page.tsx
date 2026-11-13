import Card, { PageTitle } from "@/components/Card";

export default function DataPage() {
  return (
    <>
      <PageTitle title="Data" desc="Dữ liệu có cấu trúc (PostgreSQL) và đối tượng (MinIO)." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Lưu trữ đối tượng (MinIO)">
          <p className="text-sm text-stone-600">
            Truy cập qua S3 API tại <code className="rounded bg-stone-100 px-1">s3.localhost:9080</code>: đổi JWT lấy
            thông tin tạm thời bằng STS rồi ký SigV4. Trình duyệt tải lên/xuống tệp chưa được xây dựng ở bước này.
          </p>
        </Card>
        <Card title="Cơ sở dữ liệu (PostgreSQL)">
          <p className="text-sm text-stone-600">
            Dữ liệu nghiệp vụ Tầng 3 (truy xuất nguồn gốc sản phẩm làng nghề) sẽ được lưu và truy vấn qua các API
            của Tầng 1.
          </p>
        </Card>
      </div>
    </>
  );
}
