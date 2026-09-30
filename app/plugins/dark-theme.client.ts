export default defineNuxtPlugin(() => {
  // 3D 舞台按深色基调设计（设计共识 Q23），demo 不做亮色模式。
  document.documentElement.classList.add('dark')
})
