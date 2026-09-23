import { DeleteOutlined, EyeOutlined, UploadOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Row,
  Select,
  Spin,
  Tag,
  Typography,
} from "antd";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAssets, useDeleteAsset } from "../api/hooks";
import { ASSET_KINDS, type Asset, type AssetKind } from "../api/types";
import { AssetThumb } from "../components/AssetThumb";
import { ErrorAlert } from "../components/ErrorResult";
import { UploadAssetForm } from "../components/UploadAssetForm";
import { formatBytes, formatDateTime, formatSeconds } from "../utils/format";

const PAGE_SIZE = 24;

function AssetPreview({ asset }: { asset: Asset }) {
  const { t, i18n } = useTranslation();
  let media: ReactNode = null;
  if (asset.mime.startsWith("image/")) {
    media = (
      <img
        src={asset.content_url}
        alt={asset.display_name}
        style={{ maxWidth: "100%", maxHeight: "60vh" }}
      />
    );
  } else if (asset.mime.startsWith("video/")) {
    // biome-ignore lint/a11y/useMediaCaption: 素材預覽，無字幕檔
    media = <video src={asset.content_url} controls style={{ width: "100%", maxHeight: "60vh" }} />;
  } else if (asset.mime.startsWith("audio/")) {
    // biome-ignore lint/a11y/useMediaCaption: 背景音樂預覽，無字幕
    media = <audio src={asset.content_url} controls style={{ width: "100%" }} />;
  }
  return (
    <>
      {media && (
        <Flex justify="center" style={{ marginBottom: 16, background: "#fafafa" }}>
          {media}
        </Flex>
      )}
      <Descriptions
        size="small"
        column={2}
        items={[
          { key: "kind", label: t("assets.kind"), children: t(`assetKind.${asset.kind}`) },
          { key: "mime", label: "MIME", children: asset.mime },
          { key: "size", label: t("assets.size"), children: formatBytes(asset.size) },
          {
            key: "dim",
            label: t("assets.dimensions"),
            children: asset.width && asset.height ? `${asset.width}×${asset.height}` : "—",
          },
          {
            key: "duration",
            label: t("assets.duration"),
            children: formatSeconds(asset.duration_s),
          },
          { key: "source", label: t("assets.source"), children: t(`assetSource.${asset.source}`) },
          {
            key: "created",
            label: t("assets.createdAt"),
            children: formatDateTime(asset.created_at, i18n.language),
          },
          {
            key: "tags",
            label: t("assets.tags"),
            children: asset.tags.length ? asset.tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : "—",
          },
        ]}
      />
    </>
  );
}

export function AssetsPage() {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const [kind, setKind] = useState<AssetKind | undefined>();
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<Asset | null>(null);
  const assets = useAssets({
    kind,
    tag: tag || undefined,
    q: q || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const remove = useDeleteAsset();

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t("assets.title")}
        </Typography.Title>
        <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
          {t("assets.upload")}
        </Button>
      </Flex>
      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <Select
          aria-label={t("assets.kind")}
          allowClear
          placeholder={t("assets.filterKind")}
          style={{ width: 160 }}
          value={kind}
          onChange={(v?: AssetKind) => {
            setKind(v);
            setPage(1);
          }}
          options={ASSET_KINDS.map((k) => ({ value: k, label: t(`assetKind.${k}`) }))}
        />
        <Input.Search
          allowClear
          style={{ width: 200 }}
          placeholder={t("assets.filterTag")}
          onSearch={(text) => {
            setTag(text.trim());
            setPage(1);
          }}
        />
        <Input.Search
          allowClear
          style={{ width: 240 }}
          placeholder={t("common.search")}
          onSearch={(text) => {
            setQ(text);
            setPage(1);
          }}
        />
      </Flex>
      <ErrorAlert error={assets.error ?? remove.error} />
      <Spin spinning={assets.isFetching}>
        {assets.data && assets.data.items.length === 0 ? (
          <Empty description={t("assets.empty")} />
        ) : (
          <Row gutter={[16, 16]}>
            {assets.data?.items.map((asset) => (
              <Col key={asset.id} xs={12} sm={8} md={6} lg={4}>
                <Card
                  size="small"
                  cover={<AssetThumb asset={asset} />}
                  actions={[
                    <Button
                      key="preview"
                      type="text"
                      size="small"
                      icon={<EyeOutlined />}
                      aria-label={t("assets.preview")}
                      onClick={() => setPreview(asset)}
                    />,
                    <Popconfirm
                      key="delete"
                      title={t("assets.deleteConfirm")}
                      okText={t("common.confirm")}
                      cancelText={t("common.cancel")}
                      onConfirm={() =>
                        remove.mutate(asset.id, {
                          onSuccess: () => void message.success(t("assets.deleted")),
                        })
                      }
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t("common.delete")}
                      />
                    </Popconfirm>,
                  ]}
                >
                  <Typography.Text ellipsis strong style={{ display: "block" }}>
                    {asset.display_name}
                  </Typography.Text>
                  <Flex gap={4} wrap style={{ marginTop: 4 }}>
                    <Tag color="blue">{t(`assetKind.${asset.kind}`)}</Tag>
                    {asset.tags.slice(0, 3).map((tg) => (
                      <Tag key={tg}>{tg}</Tag>
                    ))}
                  </Flex>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>
      <Pagination
        style={{ marginTop: 16, textAlign: "right" }}
        current={page}
        pageSize={PAGE_SIZE}
        total={assets.data?.total ?? 0}
        onChange={setPage}
        showSizeChanger={false}
        hideOnSinglePage
      />
      <Modal
        open={uploadOpen}
        title={t("assets.upload")}
        footer={null}
        onCancel={() => setUploadOpen(false)}
        destroyOnHidden
      >
        <UploadAssetForm
          onUploaded={() => {
            setUploadOpen(false);
            void message.success(t("assets.uploaded"));
          }}
        />
      </Modal>
      <Modal
        open={preview !== null}
        title={preview?.display_name}
        footer={null}
        width={760}
        onCancel={() => setPreview(null)}
        destroyOnHidden
      >
        {preview && <AssetPreview asset={preview} />}
      </Modal>
    </>
  );
}
