import type { FolderNode } from '../types'

/** 是否为绝对路径（盘符开头或 Unix 根开头） */
export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:\//.test(p) || p.startsWith('/')
}

/** 节点绝对路径：子节点 path 是「相对根目录」的完整路径（如 `a/b`），需与根绝对路径拼接；已是绝对路径则原样返回 */
export function resolveNodeAbsPath(nodePath: string, rootAbsNorm: string): string {
  const p = nodePath.replace(/\\/g, '/')
  return isAbsolutePath(p) ? p : rootAbsNorm + '/' + p
}

function cloneNode(node: FolderNode): FolderNode {
  return JSON.parse(JSON.stringify(node)) as FolderNode
}

/** 从文件夹树中递归查找并提取指定路径的节点子树（深拷贝）
 * 支持绝对路径或相对路径查找：根节点 path 为绝对路径，子节点为相对根路径 */
export function findSubTreeInTree(tree: FolderNode[], targetPath: string): FolderNode | null {
  const norm = targetPath.replace(/\\/g, '/').replace(/\/$/, '')
  for (const node of tree) {
    const rootNorm = node.path.replace(/\\/g, '/').replace(/\/$/, '')
    if (rootNorm === norm) return cloneNode(node)
    const found = findSubTreeInAbs(node, norm, rootNorm)
    if (found) return found
  }
  return null
}

function findSubTreeInAbs(node: FolderNode, targetNorm: string, rootAbsNorm: string): FolderNode | null {
  for (const child of node.children) {
    const childNorm = child.path.replace(/\\/g, '/')
    const childAbs = resolveNodeAbsPath(childNorm, rootAbsNorm)
    if (childAbs === targetNorm || childNorm === targetNorm) return cloneNode(child)
    const found = findSubTreeInAbs(child, targetNorm, rootAbsNorm)
    if (found) return found
  }
  return null
}

/** 在树中递归查找目标路径对应的绝对路径（支持相对/绝对路径目标） */
export function resolveRelativePathInTree(node: FolderNode, targetNorm: string, rootAbsPath: string): string | null {
  for (const child of node.children) {
    const childNorm = child.path.replace(/\\/g, '/')
    const childAbs = resolveNodeAbsPath(childNorm, rootAbsPath)
    if (childAbs === targetNorm || childNorm === targetNorm) return childAbs
    const found = resolveRelativePathInTree(child, targetNorm, rootAbsPath)
    if (found) return found
  }
  return null
}
