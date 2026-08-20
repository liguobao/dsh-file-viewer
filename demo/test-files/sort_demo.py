"""排序算法演示 — 用于测试代码高亮渲染器。"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List


@dataclass
class Item:
    name: str
    price: float
    qty: int

    @property
    def total(self) -> float:
        return self.price * self.qty


def quick_sort(items: List[Item], key) -> List[Item]:
    """快速排序：按给定 key 排序。"""
    if len(items) <= 1:
        return items
    pivot = items[len(items) // 2]
    left = [x for x in items if key(x) < key(pivot)]
    mid = [x for x in items if key(x) == key(pivot)]
    right = [x for x in items if key(x) > key(pivot)]
    return quick_sort(left, key) + mid + quick_sort(right, key)


def main() -> None:
    inventory = [
        Item("苹果", 8.5, 450),
        Item("香蕉", 3.2, 300),
        Item("西瓜", 15.5, 95),
    ]
    for item in sorted(inventory, key=lambda i: i.total, reverse=True):
        print(f"{item.name}: {item.total:.2f}")


if __name__ == "__main__":
    main()
