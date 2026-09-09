# Architecture Question：SigLIP Text ONNX 输入与官方 tokenizer 对齐

状态：Submitted for Code F review

## 发现

正式离线导出 `google/siglip2-base-patch32-256@9e7ee685...` 时，固定 revision 的
`GemmaTokenizer` 声明 `model_input_names = ["input_ids"]`，默认推理不产生
`attention_mask`。官方 `SiglipTextTransformer` 是非因果注意力，并以固定长度序列最后一个
token 的 hidden state 作为 pooled output；人为传入 mask 会改变 embedding，而不只是增加一个
无影响的输入。

Code C 先前尚未生成正式 artifact 的 export v1 草案使用了
`input_ids + attention_mask`。若继续使用，会偏离固定官方 revision 的默认推理语义。

## 提议与当前实现

- Text Encoder ONNX 只接受固定长度 64 的 `input_ids:int64[batch,64]`。
- 生产 Worker 使用官方 tokenizer 等价语义：右侧 padding、追加 EOS、不生成 mask。
- preprocess version 显式升级为
  `siglip2-processor-256-bicubic-mean0.5-official-text-v2`。
- PyTorch/ORT correctness 同时验证中英文 query、生产 SentencePiece IDs 与官方 tokenizer IDs。

这不改变 Sidecar 1.0 envelope、Media Index v1 DTO、SQLite migration 002 或 embedding dimension；
变化通过 `embedding_preprocess_version` 进入 Index Signature，因此不同语义不能混用。不存在已发布
的 v1 ONNX artifact 或 active customer index 需要迁移。

## 请求审核

请 Code F 确认：以官方固定 revision 的默认 text input contract 取代未发布的 export v1 草案，
是否可作为 v0.3 正式模型语义。不得在既有 version 下静默重新引入 attention mask。
