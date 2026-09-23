import { UploadOutlined } from "@ant-design/icons";
import { Button, Form, Select, Upload } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUploadAsset } from "../api/hooks";
import { type Asset, UPLOAD_KINDS, type UploadKind } from "../api/types";
import { ErrorAlert } from "./ErrorResult";

/** 各類上傳素材接受的檔案類型（瀏覽器端先擋，後端仍會校驗） */
export const ACCEPT: Record<UploadKind, string> = {
  logo: "image/png,image/jpeg,image/webp,image/svg+xml",
  product: "image/png,image/jpeg,image/webp",
  image: "image/png,image/jpeg,image/webp",
  bgm: "audio/mpeg,audio/wav,audio/x-wav,audio/aac,audio/mp4",
  font: ".ttf,.otf,font/ttf,font/otf",
};

interface UploadValues {
  kind: UploadKind;
  tags: string[];
}

interface Props {
  kinds?: readonly UploadKind[];
  defaultKind?: UploadKind;
  onUploaded?: (asset: Asset) => void;
}

export function parseTags(tags: string[]): string[] {
  return tags
    .flatMap((tag) => tag.split(","))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function UploadAssetForm({ kinds = UPLOAD_KINDS, defaultKind, onUploaded }: Props) {
  const { t } = useTranslation();
  const [form] = Form.useForm<UploadValues>();
  const [file, setFile] = useState<File | null>(null);
  const upload = useUploadAsset();
  const kind = Form.useWatch("kind", form) ?? defaultKind ?? kinds[0] ?? "image";

  const onFinish = (values: UploadValues) => {
    if (!file) return;
    upload.mutate(
      { file, kind: values.kind, tags: parseTags(values.tags ?? []) },
      {
        onSuccess: (asset) => {
          setFile(null);
          form.resetFields(["tags"]);
          onUploaded?.(asset);
        },
      },
    );
  };

  return (
    <Form<UploadValues>
      form={form}
      layout="vertical"
      onFinish={onFinish}
      initialValues={{ kind: defaultKind ?? kinds[0], tags: [] }}
    >
      <ErrorAlert error={upload.error} />
      <Form.Item name="kind" label={t("assets.kind")} rules={[{ required: true }]}>
        <Select options={kinds.map((k) => ({ value: k, label: t(`assetKind.${k}`) }))} />
      </Form.Item>
      <Form.Item name="tags" label={t("assets.tags")}>
        <Select mode="tags" tokenSeparators={[","]} placeholder={t("assets.tagsPlaceholder")} />
      </Form.Item>
      <Form.Item label={t("assets.file")} required>
        <Upload
          accept={ACCEPT[kind]}
          maxCount={1}
          beforeUpload={(f) => {
            setFile(f);
            return false;
          }}
          onRemove={() => setFile(null)}
          fileList={file ? [{ uid: "selected", name: file.name, status: "done" }] : []}
        >
          <Button icon={<UploadOutlined />}>{t("assets.chooseFile")}</Button>
        </Upload>
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={upload.isPending} disabled={!file}>
        {t("assets.upload")}
      </Button>
    </Form>
  );
}
