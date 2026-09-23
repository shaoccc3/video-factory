import { App as AntdApp, Drawer, Input, Pagination, Popconfirm, Select } from "antd";
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAssets, useDeleteAsset, useUploadAsset } from "../api/hooks";
import {
  ASSET_KINDS,
  type Asset,
  type AssetKind,
  UPLOAD_KINDS,
  type UploadKind,
} from "../api/types";
import { AssetThumb } from "../components/AssetThumb";
import { ErrorAlert } from "../components/ErrorResult";
import { ACCEPT, parseTags } from "../components/UploadAssetForm";
import { formatBytes, formatDateTime, formatSeconds } from "../utils/format";
import "./assets.css";

const PAGE_SIZE = 24;
const GENERATED_KINDS = ASSET_KINDS.filter(
  (k): k is Exclude<AssetKind, UploadKind> => !(UPLOAD_KINDS as readonly string[]).includes(k),
);

/** 檔案符合 accept 清單（MIME 或副檔名）才收 */
export function accepts(accept: string, file: File): boolean {
  const name = file.name.toLowerCase();
  return accept
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .some((a) => (a.startsWith(".") ? name.endsWith(a) : file.type === a));
}

/** 依檔案猜素材類型：音訊→背景音樂、字體→字體，其餘圖片→商品圖（Logo 由使用者選） */
export function guessKind(file: File): UploadKind {
  if (file.type.startsWith("audio/")) return "bgm";
  if (/\.(ttf|otf|ttc)$/i.test(file.name) || file.type.startsWith("font/")) return "font";
  return "product";
}

/** 上方的虛線拖曳上傳條：拖進來或選檔案，確認類型與標籤後上傳 */
function UploadStrip() {
  const { t } = useTranslation();
  const { message } = AntdApp.useApp();
  const upload = useUploadAsset();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<UploadKind>("product");
  const [tags, setTags] = useState("");
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    const guessed = guessKind(picked);
    if (!accepts(ACCEPT[guessed], picked)) {
      setRejected(picked.name);
      setFile(null);
      return;
    }
    setRejected(null);
    setFile(picked);
    setKind(guessed);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    pick(event.dataTransfer.files[0]);
  };

  const submit = () => {
    if (!file) return;
    if (!accepts(ACCEPT[kind], file)) {
      setRejected(file.name);
      return;
    }
    upload.mutate(
      { file, kind, tags: parseTags([tags]) },
      {
        onSuccess: () => {
          setFile(null);
          setTags("");
          if (inputRef.current) inputRef.current.value = "";
          void message.success(t("assets.uploaded"));
        },
      },
    );
  };

  return (
    <section
      className="vf-drop-strip"
      data-over={over}
      aria-label={t("assets.upload")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        className="vf-sr-only"
        id="vf-asset-file"
        accept={Object.values(ACCEPT).join(",")}
        onChange={(e) => pick(e.target.files?.[0])}
        tabIndex={-1}
      />
      {file ? (
        <div className="vf-drop-pending">
          <span className="vf-drop-file">
            <span className="vf-mono vf-muted">{t("mono.file")}</span>
            {file.name}
            <span className="vf-mono vf-muted">{formatBytes(file.size)}</span>
          </span>
          <Select<UploadKind>
            aria-label={t("assets.kind")}
            value={kind}
            onChange={setKind}
            style={{ width: 140 }}
            options={UPLOAD_KINDS.map((k) => ({ value: k, label: t(`assetKind.${k}`) }))}
          />
          <Input
            aria-label={t("assets.tags")}
            placeholder={t("assets.tagsComma")}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            style={{ width: 220 }}
          />
          <button
            type="button"
            className="vf-btn vf-btn-primary"
            disabled={upload.isPending}
            aria-busy={upload.isPending}
            onClick={submit}
          >
            {t("assets.upload")}
          </button>
          <button type="button" className="vf-btn vf-btn-ghost" onClick={() => setFile(null)}>
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <div className="vf-drop-idle">
          <span className="vf-drop-icon" aria-hidden="true">
            ＋
          </span>
          <span>{t("assets.dropHint")}</span>
          <button
            type="button"
            className="vf-btn vf-btn-outline"
            onClick={() => inputRef.current?.click()}
          >
            {t("assets.chooseFile")}
          </button>
          <span className="vf-mono vf-muted vf-drop-types">{t("assets.dropTypes")}</span>
        </div>
      )}
      {rejected && (
        <span className="vf-field-error" role="alert">
          {t("assets.rejectedType", { name: rejected })}
        </span>
      )}
      <ErrorAlert error={upload.error} />
    </section>
  );
}

/** 右側抽屜：預覽、規格、標籤與用途 */
function AssetDrawer({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { message } = AntdApp.useApp();
  const remove = useDeleteAsset();
  let media: ReactNode = null;
  if (asset?.mime.startsWith("image/")) {
    media = <img src={asset.content_url} alt={asset.display_name} />;
  } else if (asset?.mime.startsWith("video/")) {
    // biome-ignore lint/a11y/useMediaCaption: 素材預覽，無字幕檔
    media = <video src={asset.content_url} controls />;
  } else if (asset?.mime.startsWith("audio/")) {
    // biome-ignore lint/a11y/useMediaCaption: 背景音樂預覽，無字幕
    media = <audio src={asset.content_url} controls />;
  }
  const rows: [string, string][] = asset
    ? [
        [t("assets.kind"), t(`assetKind.${asset.kind}`)],
        ["MIME", asset.mime],
        [t("assets.size"), formatBytes(asset.size)],
        [
          t("assets.dimensions"),
          asset.width && asset.height ? `${asset.width}×${asset.height}` : "—",
        ],
        [t("assets.duration"), formatSeconds(asset.duration_s)],
        [t("assets.source"), t(`assetSource.${asset.source}`)],
        [t("assets.createdAt"), formatDateTime(asset.created_at, i18n.language)],
      ]
    : [];
  return (
    <Drawer
      open={asset !== null}
      onClose={onClose}
      title={asset?.display_name}
      size="large"
      rootClassName="vf-asset-drawer"
    >
      {asset && (
        <div className="vf-asset-detail">
          {media && <div className="vf-asset-media">{media}</div>}
          <section>
            <h3 className="vf-label">{t("assets.usageTitle")}</h3>
            <p>{t(`assets.usage.${asset.kind}`)}</p>
          </section>
          <section>
            <h3 className="vf-label">{t("assets.tags")}</h3>
            {asset.tags.length ? (
              <ul className="vf-asset-tags">
                {asset.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            ) : (
              <p className="vf-muted">—</p>
            )}
          </section>
          <dl className="vf-asset-specs">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="vf-label">{label}</dt>
                <dd className="vf-mono">{value}</dd>
              </div>
            ))}
          </dl>
          <ErrorAlert error={remove.error} />
          <Popconfirm
            title={t("assets.deleteConfirm")}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
            onConfirm={() =>
              remove.mutate(asset.id, {
                onSuccess: () => {
                  void message.success(t("assets.deleted"));
                  onClose();
                },
              })
            }
          >
            <button type="button" className="vf-btn vf-btn-ghost vf-btn-danger">
              {t("common.delete")}
            </button>
          </Popconfirm>
        </div>
      )}
    </Drawer>
  );
}

function KindTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="vf-tab" aria-pressed={active} onClick={onClick}>
      {label}
    </button>
  );
}

/** 素材：拖曳上傳條、印樣表網格（等寬編號與類型）、右側抽屜 */
export function AssetsPage() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AssetKind | undefined>();
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Asset | null>(null);
  const assets = useAssets({
    kind,
    tag: tag || undefined,
    q: q || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const choose = (k: AssetKind | undefined) => {
    setKind(k);
    setPage(1);
  };
  const items = assets.data?.items ?? [];

  return (
    <div className="vf-assets">
      <header className="vf-assets-head vf-rise">
        <span className="vf-label">
          {t("mono.contactSheet")}
          {assets.data ? ` · ${assets.data.total}` : ""}
        </span>
        <h1 className="vf-serif">{t("nav.assets")}</h1>
      </header>
      <UploadStrip />
      <div className="vf-assets-filters">
        <fieldset className="vf-tabs vf-assets-kinds" aria-label={t("assets.kindsUploaded")}>
          <KindTab
            label={t("assets.filterKind")}
            active={!kind}
            onClick={() => choose(undefined)}
          />
          {UPLOAD_KINDS.map((k) => (
            <KindTab
              key={k}
              label={t(`assetKind.${k}`)}
              active={kind === k}
              onClick={() => choose(k)}
            />
          ))}
        </fieldset>
        <fieldset className="vf-tabs vf-assets-kinds" aria-label={t("assets.kindsGenerated")}>
          <span className="vf-label" aria-hidden="true">
            {t("assetSource.generated")}
          </span>
          {GENERATED_KINDS.map((k) => (
            <KindTab
              key={k}
              label={t(`assetKind.${k}`)}
              active={kind === k}
              onClick={() => choose(k)}
            />
          ))}
        </fieldset>
        <div className="vf-assets-search">
          <Input.Search
            allowClear
            aria-label={t("assets.filterTag")}
            placeholder={t("assets.filterTag")}
            onSearch={(text) => {
              setTag(text.trim());
              setPage(1);
            }}
          />
          <Input.Search
            allowClear
            aria-label={t("common.search")}
            placeholder={t("common.search")}
            onSearch={(text) => {
              setQ(text);
              setPage(1);
            }}
          />
        </div>
      </div>
      <ErrorAlert error={assets.error} />
      {assets.isPending ? (
        <div className="vf-sheet" aria-busy="true">
          {["a", "b", "c", "d", "e", "f"].map((key) => (
            <span key={key} className="vf-skel vf-sheet-skel" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="vf-assets-empty">{t("assets.empty")}</p>
      ) : (
        <ul className="vf-sheet">
          {items.map((asset, i) => (
            <li key={asset.id}>
              <button
                type="button"
                className="vf-sheet-cell"
                aria-label={asset.display_name}
                onClick={() => setSelected(asset)}
              >
                <span className="vf-sheet-frame">
                  <AssetThumb asset={asset} />
                </span>
                <span className="vf-sheet-meta vf-mono">
                  <span>#{String((page - 1) * PAGE_SIZE + i + 1).padStart(4, "0")}</span>
                  <span>{t(`assetKind.${asset.kind}`)}</span>
                </span>
                <span className="vf-sheet-name">{asset.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        className="vf-assets-pager"
        current={page}
        pageSize={PAGE_SIZE}
        total={assets.data?.total ?? 0}
        onChange={setPage}
        showSizeChanger={false}
        hideOnSinglePage
      />
      <AssetDrawer asset={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
