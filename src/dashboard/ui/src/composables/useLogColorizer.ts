import { playTrace } from '@/api/run'
import { useTerminalStore } from '@/stores/terminal'

// Expose global handlers if not already defined
if (typeof window !== 'undefined') {
  (window as any).playTraceFromLog = async (encodedCaseName: string, encodedTraceFile: string) => {
    const caseName = decodeURIComponent(encodedCaseName)
    const traceFile = decodeURIComponent(encodedTraceFile)
    try {
      const res = await playTrace(caseName, traceFile)
      if (!res.success) {
        alert(`无法播放录像: ${res.error || '未知错误'}`)
      }
    } catch (err) {
      console.error(err)
      alert('播放录像失败')
    }
  };

  (window as any).openScreenshotFromLog = (encodedCaseName: string, encodedFileName: string) => {
    const caseName = decodeURIComponent(encodedCaseName)
    const fileName = decodeURIComponent(encodedFileName)
    const terminalStore = useTerminalStore()
    const url = `/api/screenshots/${encodeURIComponent(caseName)}/${encodeURIComponent(fileName)}`
    
    const index = terminalStore.screenshots.indexOf(url)
    if (index !== -1) {
      terminalStore.openLightbox(index)
    } else {
      terminalStore.screenshots.push(url)
      terminalStore.openLightbox(terminalStore.screenshots.length - 1)
    }
  };
}

// ── 终端日志高亮着色 ──────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function useLogColorizer() {
  function colorizeLine(line: string): string {
    // 1. [dsl] commands
    if (line.includes('[dsl]')) {
      const dslMatch = line.match(/^(\[dsl\]\s+)(\??\s*)([a-zA-Z0-9_]+)(\s+.*)?$/)
      if (dslMatch) {
        const prefix = dslMatch[1]
        const optional = dslMatch[2]
        const cmd = dslMatch[3]
        const rest = dslMatch[4] || ''

        const colorMap: Record<string, string> = {
          open: '#38bdf8',
          input: '#f59e0b',
          tap: '#10b981',
          screenshot: '#f472b6',
          wait: '#94a3b8',
          check: '#818cf8',
          upload: '#818cf8',
          macro: '#fb923c',
          keyboard: '#2dd4bf',
          hover: '#2dd4bf',
          scroll_to: '#2dd4bf',
          execute_script: '#eab308',
        }
        let cmdColor = '#f8fafc'
        if (cmd.startsWith('assert_')) cmdColor = '#c084fc'
        else if (cmd.startsWith('do_')) cmdColor = '#f43f5e'
        else cmdColor = colorMap[cmd] || '#f8fafc'

        const optHtml = optional ? `<span style="color:#ef4444">${optional}</span>` : ''
        return `<span style="color:#64748b">${prefix}</span>${optHtml}<span style="color:${cmdColor};font-weight:bold">${cmd}</span>${rest}`
      }

      // Variable assignments
      const assignMatch = line.match(/^(\[dsl\]\s+)(\s*)(\$[a-zA-Z0-9_]+)(\s*=\s*)(.*)$/)
      if (assignMatch) {
        return `<span style="color:#64748b">${assignMatch[1]}</span>${assignMatch[2]}<span style="color:#2dd4bf">${assignMatch[3]}</span><span style="color:#94a3b8">${assignMatch[4]}</span><span style="color:#cbd5e1">${assignMatch[5]}</span>`
      }
    }

    // 2. [step] logs
    if (line.includes('[step]')) {
      if (line.includes('✓ Step completed')) return `<span style="color:#10b981;font-weight:bold">${line}</span>`
      if (line.includes('✗ Step failed') || line.includes('failed after')) return `<span style="color:#ef4444;font-weight:bold">${line}</span>`
      
      // Check for tracing file saved
      if (line.includes('✓ Tracing file saved:')) {
        const match = line.match(/^(.*✓ Tracing file saved:\s+)(\.resumewright\/([^\/]+)\/traces\/([^\s]+))$/)
        if (match) {
          const prefix = match[1]!
          const fullPath = match[2]!
          const caseName = match[3]!
          const traceFile = match[4]!
          return `${prefix}<a href="javascript:void(0)" onclick="window.playTraceFromLog('${encodeURIComponent(caseName)}', '${encodeURIComponent(traceFile)}')" style="color:#38bdf8;text-decoration:underline;font-weight:bold;cursor:pointer">${fullPath}</a>`
        }
      }

      // Check for error screenshot
      if (line.includes('📸 Error screenshot:')) {
        const match = line.match(/^(.*📸 Error screenshot:\s+)(\.resumewright\/([^\/]+)\/screenshots\/([^\s]+))$/)
        if (match) {
          const prefix = match[1]!
          const fullPath = match[2]!
          const caseName = match[3]!
          const fileName = match[4]!
          return `${prefix}<a href="javascript:void(0)" onclick="window.openScreenshotFromLog('${encodeURIComponent(caseName)}', '${encodeURIComponent(fileName)}')" style="color:#f472b6;text-decoration:underline;font-weight:bold;cursor:pointer">${fullPath}</a>`
        }
      }

      return `<span style="color:#38bdf8">${line}</span>`
    }

    // 3. [runner] logs
    if (line.includes('[runner]')) {
      if (line.includes('✅ Case PASSED')) return `<span style="color:#10b981;font-weight:bold;font-size:13px">${line}</span>`
      if (line.includes('❌ Case FAILED')) return `<span style="color:#ef4444;font-weight:bold;font-size:13px">${line}</span>`
      return `<span style="color:#c084fc">${line}</span>`
    }

    // 4. [network-interceptor] logs
    if (line.includes('[network-interceptor]')) return `<span style="color:#64748b">${line}</span>`

    // 5. [checkpoint] logs
    if (line.includes('[checkpoint]')) return `<span style="color:#f59e0b">${line}</span>`

    // 6. [role-pool] logs
    if (line.includes('[role-pool]')) return `<span style="color:#eab308">${line}</span>`

    // 7. [system] logs
    if (line.includes('[system]')) return `<span style="color:#94a3b8;font-style:italic">${line}</span>`

    return line
  }

  function colorizeLogs(text: string): string {
    const escaped = escapeHtml(text)
    return escaped.split('\n').map(colorizeLine).join('\n')
  }

  return { colorizeLogs }
}
