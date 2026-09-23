import { CheckCircleFilled, CloseOutlined, PictureOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  Modal,
  Pagination,
  Row,
  Select,
  Spin,
  Tabs,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsset, useAssets } from "../api/hooks";
import "./assetPicker.css";
import type { AssetKind, UploadKind } from "../api/types";
import { AssetThumb } from "./AssetThumb";
import { UploadAssetForm } from "./UploadAssetForm";

const PAGE_SIZE = 12;

interface AssetPickerProps {
  /** 素材庫裡可選的 kind */
  kinds: readonly AssetKind[];
  /** 行內上傳時允許的 kind；空陣列表示不可上傳 */
  uploadKinds?: readonly UploadKind[];
  multiple?: boolean;
  value?: string[];
  onChange?: (ids: string[]) => void;
  buttonText: string;
  disabled?: boolean;
}

function SelectedAsset({ id, onRemove }: { id: string; onRemove?: (() => void) | undefined }) {
  const { t } = useTranslation();
  const asset = useAsset(id);
  return (
    <div className="vf-ref-chip" data-testid={`selected-asset-${id}`}>
      <div className="vf-ref-thumb">
        {asset.data ? <AssetThumb asset={asset.data} height={72} /> : <Spin size="small" />}
      </div>
      <div className="vf-ref-meta">
        <span className="vf-ref-name">{asset.data?.display_name ?? ""}</span>
        {asset.data && (
          <span className="vf-mono vf-muted">{t(`assetKind.${asset.data.kind}`)}</span>
        )}
      </div>
      {onRemove && (
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          aria-label={t("common.remove")}
          onClick={onRemove}
        />
      )}
    </div>
  );
}

export function AssetPicker({
  kinds,
  uploadKinds = [],
  multiple = false,
  value = [],
  onChange = () => {},
  buttonText,
  disabled = false,
}: AssetPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AssetKind>(kinds[0] ?? "image");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<string[]>(value);
  const [tab, setTab] = useState("library");
  const assets = useAssets({ kind, q: q || undefined, page, page_size: PAGE_SIZE }, open);

  const toggle = (id: string) => {
    if (multiple) {
      setDraft((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    } else {
      setDraft((cur) => (cur[0] === id ? [] : [id]));
    }
  };

  const openModal = () => {
    setDraft(value);
    setTab("library");
    setOpen(true);
  };

  return (
    <>
      <div className="vf-ref-row">
        {value.map((id) => (
          <SelectedAsset
            key={id}
            id={id}
            onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== id))}
          />
        ))}
        <button type="button" className="vf-ref-add" onClick={openModal} disabled={disabled}>
          <PictureOutlined aria-hidden="true" />
          {buttonText}
        </button>
      </div>
      <Modal
        open={open}
        title={buttonText}
        width={860}
        onCancel={() => setOpen(false)}
        onOk={() => {
          onChange(draft);
          setOpen(false);
        }}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
        destroyOnHidden
      >
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "library",
              label: t("assetPicker.library"),
              children: (
                <>
                  <Flex gap={8} style={{ marginBottom: 12 }}>
                    <Select
                      aria-label={t("assets.kind")}
                      style={{ width: 160 }}
                      value={kind}
                      onChange={(k: AssetKind) => {
                        setKind(k);
                        setPage(1);
                      }}
                      options={kinds.map((k) => ({ value: k, label: t(`assetKind.${k}`) }))}
                    />
                    <Input.Search
                      allowClear
                      placeholder={t("common.search")}
                      onSearch={(text) => {
                        setQ(text);
                        setPage(1);
                      }}
                    />
                  </Flex>
                  <Spin spinning={assets.isFetching}>
                    {assets.data && assets.data.items.length === 0 ? (
                      <Empty description={t("assets.empty")} />
                    ) : (
                      <Row gutter={[8, 8]}>
                        {assets.data?.items.map((asset) => {
                          const selected = draft.includes(asset.id);
                          return (
                            <Col key={asset.id} xs={8} sm={6} md={4}>
                              <Card
                                hoverable
                                size="small"
                                onClick={() => toggle(asset.id)}
                                styles={{ body: { padding: 4 } }}
                                style={{
                                  borderColor: selected ? "var(--vf-accent)" : undefined,
                                  position: "relative",
                                }}
                                aria-pressed={selected}
                                role="button"
                                aria-label={asset.display_name}
                              >
                                <AssetThumb asset={asset} />
                                <Typography.Text ellipsis style={{ fontSize: 12 }}>
                                  {asset.display_name}
                                </Typography.Text>
                                {selected && (
                                  <CheckCircleFilled
                                    style={{
                                      position: "absolute",
                                      top: 6,
                                      right: 6,
                                      color: "var(--vf-accent)",
                                      fontSize: 18,
                                    }}
                                  />
                                )}
                              </Card>
                            </Col>
                          );
                        })}
                      </Row>
                    )}
                  </Spin>
                  <Pagination
                    style={{ marginTop: 12, textAlign: "right" }}
                    size="small"
                    current={page}
                    pageSize={PAGE_SIZE}
                    total={assets.data?.total ?? 0}
                    onChange={setPage}
                    showSizeChanger={false}
                  />
                </>
              ),
            },
            ...(uploadKinds.length > 0
              ? [
                  {
                    key: "upload",
                    label: t("assetPicker.upload"),
                    children: (
                      <UploadAssetForm
                        kinds={uploadKinds}
                        onUploaded={(asset) => {
                          if (multiple) setDraft((cur) => [...cur, asset.id]);
                          else setDraft([asset.id]);
                          if ((kinds as readonly string[]).includes(asset.kind))
                            setKind(asset.kind);
                          setTab("library");
                        }}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Modal>
    </>
  );
}
